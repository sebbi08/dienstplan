import { todayIso } from '../../shared/domain/dates'
import { migrateDb } from '../db/client'
import { ensureInitialAdmin, resetAdminFromEnv, seedDefaults } from '../db/seed'
import { runDailyBackup } from '../services/backup'

const HOUR_MS = 60 * 60 * 1000

export default defineNitroPlugin(() => {
  const db = useDb()
  migrateDb(db, process.env.MIGRATIONS_DIR || 'server/db/migrations')
  seedDefaults(db)
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

  const backupDir = process.env.BACKUP_DIR
  if (backupDir) {
    const backup = () => runDailyBackup(useSqlite(), backupDir, todayIso())
      .then(file => file && console.info(`Backup written: ${file}`))
      .catch(error => console.error('Backup failed', error))
    void backup()
    setInterval(backup, HOUR_MS).unref()
  }
})
