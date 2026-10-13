import { todayIso } from '../../shared/domain/dates'
import { checkpointWal, migrateDb } from '../db/client'
import { ensureInitialAdmin, resetAdminFromEnv, seedDefaults } from '../db/seed'
import { runDailyBackup } from '../services/backup'
import { applyDueGroupChanges } from '../services/childGroupChanges'
import { purgeExpiredChildren } from '../services/children'
import { backfillSnapshots } from '../services/release'
import { leaveSchoolChildren } from '../services/schoolChildren'

const HOUR_MS = 60 * 60 * 1000

export default defineNitroPlugin(() => {
  const db = useDb()
  migrateDb(db, process.env.MIGRATIONS_DIR || 'server/db/migrations')
  seedDefaults(db)
  const backfilled = backfillSnapshots(db)
  if (backfilled > 0) console.info(`Created release snapshots for ${backfilled} previously released month(s).`)
  if (ensureInitialAdmin(db, process.env.ADMIN_USERNAME, process.env.ADMIN_PASSWORD)) {
    console.info(`Initial admin "${process.env.ADMIN_USERNAME}" created.`)
  }
  if (process.env.ADMIN_RESET_PASSWORD) {
    const name = process.env.ADMIN_USERNAME
    if (resetAdminFromEnv(db, name, process.env.ADMIN_RESET_PASSWORD)) {
      console.warn(`Admin password for "${name}" was reset from ADMIN_RESET_PASSWORD. Remove this variable now.`)
    }
    else {
      console.warn(`ADMIN_RESET_PASSWORD is set but was not applied: user "${name}" does not exist, ADMIN_USERNAME is missing or the password is too short. Remove this variable.`)
    }
  }

  // The daily run (tried every hour, each part does its work once): planned group changes whose day has come, then
  // the school children who leave (a change into a group for school children is applied by then), then deleting
  // children after their retention period. None depends on another one succeeding or on the backups being configured.
  const dailyRun = () => {
    // One day for all parts: a run across midnight must not apply changes for one day and deregister for the next.
    const today = todayIso()
    try {
      const applied = applyDueGroupChanges(db, today)
      if (applied > 0) console.info(`Applied ${applied} group change(s).`)
    }
    catch (error) {
      console.error('Applying planned group changes failed', error)
    }
    try {
      // Only the number goes into the log, never a name. A facility that fails is logged by the service and skipped.
      const deregistered = leaveSchoolChildren(db, today)
      if (deregistered > 0) console.info(`Deregistered ${deregistered} school child(ren).`)
    }
    catch (error) {
      console.error('Deregistering school children failed', error)
    }
    try {
      const deleted = purgeExpiredChildren(db, today)
      if (deleted > 0) {
        checkpointWal(useSqlite())
        console.info(`Deleted ${deleted} child record(s) after the retention period.`)
      }
    }
    catch (error) {
      console.error('Deleting expired child records failed', error)
    }
  }
  dailyRun()
  setInterval(dailyRun, HOUR_MS).unref()

  const backupDir = process.env.BACKUP_DIR
  if (backupDir) {
    const backup = () => runDailyBackup(useSqlite(), backupDir, todayIso())
      .then(file => file && console.info(`Backup written: ${file}`))
      .catch(error => console.error('Backup failed', error))
    void backup()
    setInterval(backup, HOUR_MS).unref()
  }
})
