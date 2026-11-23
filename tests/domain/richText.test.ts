import { describe, expect, it } from 'vitest'
import {
  isRichText, plainTextToRichText, richTextFromAnswer, richTextHtml, richTextInlineHtml, richTextLength, richTextToPlain,
  sameTextAnswer, sanitizeRichText, textAnswerLength,
} from '../../shared/domain/richText'

describe('sanitizeRichText', () => {
  it('keeps the allowed tags and makes b/i into strong/em', () => {
    expect(sanitizeRichText('<p>a <b>fett</b> <i>kursiv</i> <u>unter</u> <strong>s</strong> <em>e</em></p>'))
      .toBe('<p>a <strong>fett</strong> <em>kursiv</em> <u>unter</u> <strong>s</strong> <em>e</em></p>')
    expect(sanitizeRichText('<ul><li><p>eins</p></li><li><p>zwei</p></li></ul><ol><li><p>drei</p></li></ol>'))
      .toBe('<ul><li><p>eins</p></li><li><p>zwei</p></li></ul><ol><li><p>drei</p></li></ol>')
    expect(sanitizeRichText('<p>Zeile 1<br>Zeile 2<br/>Zeile 3</p>')).toBe('<p>Zeile 1<br>Zeile 2<br>Zeile 3</p>')
  })

  it('drops scripts, styles and comments with their content', () => {
    expect(sanitizeRichText('<p>a<script>alert(1)</script>b</p>')).toBe('<p>ab</p>')
    expect(sanitizeRichText('<p>a<SCRIPT type="x">alert("</p>")</SCRIPT >b</p>')).toBe('<p>ab</p>')
    expect(sanitizeRichText('<style>p { color: red }</style><p>x</p>')).toBe('<p>x</p>')
    expect(sanitizeRichText('<p>a<!-- geheim <b>x</b> -->b</p>')).toBe('<p>ab</p>')
    expect(sanitizeRichText('<p>a<!--[if !supportLists]-->b<!--[endif]--></p>')).toBe('<p>ab</p>')
    expect(sanitizeRichText('<p>vorher</p><script>alert(1)')).toBe('<p>vorher</p>')
    expect(sanitizeRichText('<p>a</p><iframe src="https://x"><p>b</p></iframe><svg><p>c</p></svg>')).toBe('<p>a</p>')
  })

  it('drops every attribute, event handlers and javascript: links included', () => {
    expect(sanitizeRichText('<p class="x" style="color:red" onclick="alert(1)">a</p>')).toBe('<p>a</p>')
    expect(sanitizeRichText('<p><strong onmouseover=alert(1)>b</strong></p>')).toBe('<p><strong>b</strong></p>')
    expect(sanitizeRichText('<p><a href="javascript:alert(1)">Link</a></p>')).toBe('<p>Link</p>')
    expect(sanitizeRichText('<p><img src=x onerror=alert(1)>c</p>')).toBe('<p>c</p>')
    expect(sanitizeRichText('<p title="a > b">d</p>')).toBe('<p>d</p>')
    expect(sanitizeRichText('<p title=\'<script>alert(1)</script>\'>e</p>')).toBe('<p>e</p>')
  })

  it('keeps the text of unknown tags and splits at block tags', () => {
    expect(sanitizeRichText('<p><span>a</span><font>b</font><o:p></o:p></p>')).toBe('<p>ab</p>')
    expect(sanitizeRichText('<div>eins</div><div>zwei</div>')).toBe('<p>eins</p><p>zwei</p>')
    expect(sanitizeRichText('<h1>Titel</h1><blockquote>Zitat</blockquote>')).toBe('<p>Titel</p><p>Zitat</p>')
    expect(sanitizeRichText('lose <b>Text</b>')).toBe('<p>lose <strong>Text</strong></p>')
  })

  it('escapes text and decodes entities once', () => {
    expect(sanitizeRichText('<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot; &#228;&#xFC; &nbsp;</p>'))
      .toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; "x" äü  </p>')
    expect(sanitizeRichText('<p>a < b > c</p>')).toBe('<p>a &lt; b &gt; c</p>')
    expect(sanitizeRichText('<p>&unbekannt; &#0; &#xD800;</p>')).toBe('<p>&amp;unbekannt; � �</p>')
  })

  it('nests lists and repairs broken nesting', () => {
    expect(sanitizeRichText('<ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul>'))
      .toBe('<ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul>')
    // A list directly inside a list belongs to the item before it.
    expect(sanitizeRichText('<ul><li>a</li><ul><li>b</li></ul></ul>')).toBe('<ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul>')
    // Unclosed items close at the next one; loose items get a list.
    expect(sanitizeRichText('<ul><li>a<li>b</ul>')).toBe('<ul><li><p>a</p></li><li><p>b</p></li></ul>')
    expect(sanitizeRichText('<li>lose</li>')).toBe('<ul><li><p>lose</p></li></ul>')
    expect(sanitizeRichText('<ul>text<li>x</li></ul>')).toBe('<ul><li><p>text</p></li><li><p>x</p></li></ul>')
    // Formatting around blocks moves into them; marks are ordered strong > em > u.
    expect(sanitizeRichText('<b><p>a</p><p>b</p></b>')).toBe('<p><strong>a</strong></p><p><strong>b</strong></p>')
    expect(sanitizeRichText('<p><u><i><b>x</b></i></u></p>')).toBe('<p><strong><em><u>x</u></em></strong></p>')
    expect(sanitizeRichText('<p><b>a</b><b>b</b></p>')).toBe('<p><strong>ab</strong></p>')
    // Unclosed and stray end tags.
    expect(sanitizeRichText('<p><b>a</p><p>b</p>')).toBe('<p><strong>a</strong></p><p>b</p>')
    expect(sanitizeRichText('</b></li></ul><p>a</p></p>')).toBe('<p>a</p>')
  })

  it('limits the depth of lists', () => {
    const deep = '<ul><li>x'.repeat(50) + '</li></ul>'.repeat(50)
    const html = sanitizeRichText(deep)
    expect(html.match(/<ul>/g)!.length).toBeLessThanOrEqual(10)
    expect(sanitizeRichText(html)).toBe(html)
  })

  it('collapses white space, trims and drops empty content', () => {
    expect(sanitizeRichText('<p>  a \n\t b  </p>')).toBe('<p>a b</p>')
    expect(sanitizeRichText('<p>a <b> b</b></p>')).toBe('<p>a <strong>b</strong></p>')
    expect(sanitizeRichText('<p></p><p>a</p><p></p><p>b</p><p> </p>')).toBe('<p>a</p><p></p><p>b</p>')
    expect(sanitizeRichText('<p></p>')).toBe('')
    expect(sanitizeRichText('<ul><li><p></p></li></ul>')).toBe('')
    expect(sanitizeRichText('<ul><li><p>a</p></li><li></li></ul>')).toBe('<ul><li><p>a</p></li></ul>')
    expect(sanitizeRichText('')).toBe('')
    expect(sanitizeRichText('<p>a\u0000b\u0007c</p>')).toBe('<p>abc</p>')
  })

  it('handles huge input in linear time', () => {
    const big = '<p><b>x</b></p>'.repeat(50_000) + '<span>'.repeat(20_000) + 'y'
    const started = Date.now()
    const html = sanitizeRichText(big)
    expect(Date.now() - started).toBeLessThan(2000)
    expect(html.startsWith('<p><strong>x</strong></p>')).toBe(true)
    expect(html.endsWith('<p>y</p>')).toBe(true)
  })

  it('is idempotent', () => {
    const inputs = [
      '<p>a <b>b <i>c</i></b> d</p><ul><li>x<ul><li>y</li></ul></li></ul><p></p><p>z<br></p>',
      '<b><p>a</p>b</b><ol><li><p>1</p><p>2</p></li></ol>',
      '<p> &amp;&lt;   </p><p><u> </u>a</p>',
    ]
    for (const input of inputs) {
      const once = sanitizeRichText(input)
      expect(sanitizeRichText(once)).toBe(once)
    }
  })
})

describe('isRichText', () => {
  it('tells stored HTML from old plain text', () => {
    expect(isRichText('<p>a</p>')).toBe(true)
    expect(isRichText('<ul><li><p>a</p></li></ul>')).toBe(true)
    expect(isRichText('<ol><li><p>a</p></li></ol>')).toBe(true)
    expect(isRichText('<P class="x">a</P>')).toBe(true)
    expect(isRichText('a < b')).toBe(false)
    expect(isRichText('<b>fett</b>')).toBe(false)
    expect(isRichText(' <p>a</p>')).toBe(false)
    expect(isRichText('<pre>')).toBe(false)
    expect(isRichText('')).toBe(false)
  })
})

describe('plain text (answers stored before the formatting)', () => {
  it('becomes escaped paragraphs, one per line', () => {
    expect(plainTextToRichText('Zeile 1\nZeile <2> & mehr\n\nZeile 4')).toBe('<p>Zeile 1</p><p>Zeile &lt;2&gt; &amp; mehr</p><p></p><p>Zeile 4</p>')
    expect(plainTextToRichText('<script>alert(1)</script>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
    expect(plainTextToRichText('\r\n a \r\n')).toBe('<p>a</p>')
    expect(plainTextToRichText('')).toBe('')
  })

  it('is shown escaped with its line breaks', () => {
    expect(richTextHtml('a <b>\nb')).toBe('<p>a &lt;b&gt;</p><p>b</p>')
    expect(richTextHtml('<p>x</p><script>alert(1)</script>')).toBe('<p>x</p>')
    expect(richTextFromAnswer('a\nb')).toBe('<p>a</p><p>b</p>')
    expect(richTextFromAnswer('<p onclick="x">a</p>')).toBe('<p>a</p>')
  })
})

describe('richTextLength', () => {
  it('counts the characters, one per line break and one between paragraphs', () => {
    expect(richTextLength('<p>abc</p>')).toBe(3)
    expect(richTextLength('<p>a<br>b</p>')).toBe(3)
    expect(richTextLength('<p>a</p><p>b</p>')).toBe(3)
    expect(richTextLength('<p>a</p><p></p><p>b</p>')).toBe(4)
    expect(richTextLength('<ul><li><p>ab</p></li><li><p>c</p></li></ul>')).toBe(4)
    expect(richTextLength('<p>&amp;</p>')).toBe(1)
    expect(richTextLength('')).toBe(0)
  })

  it('counts a plain answer by its characters', () => {
    expect(textAnswerLength('a\nb')).toBe(3)
    expect(textAnswerLength('<b>a</b>')).toBe(8)
    expect(textAnswerLength('<p><b>a</b></p>')).toBe(1)
  })
})

describe('richTextToPlain', () => {
  it('writes lists as lines with bullets or numbers', () => {
    expect(richTextToPlain('<p>a <strong>b</strong></p><ul><li><p>x</p><ul><li><p>y</p></li></ul></li></ul><ol><li><p>eins</p></li><li><p>zwei<br>mehr</p></li></ol>'))
      .toBe('a b\n• x\n  • y\n1. eins\n2. zwei\n   mehr')
    expect(richTextToPlain('alter Text\nmit Zeilen')).toBe('alter Text\nmit Zeilen')
    expect(richTextToPlain('<p>&lt;&amp;</p>')).toBe('<&')
  })
})

describe('richTextInlineHtml (fixed boxes of the U 1000)', () => {
  it('keeps marks, writes paragraphs and list items as lines', () => {
    expect(richTextInlineHtml('<p>a <strong>b</strong></p><ul><li><p>x</p></li></ul><ol><li><p><em>y</em></p></li></ol>'))
      .toBe('a <strong>b</strong><br>• x<br>1. <em>y</em>')
    expect(richTextInlineHtml('a <b>\nb')).toBe('a &lt;b&gt;<br>b')
    expect(richTextInlineHtml('<p>a</p><script>x</script>')).toBe('a')
  })
})

describe('sameTextAnswer', () => {
  it('treats equivalent HTML and the plain text it came from as equal', () => {
    expect(sameTextAnswer('<p><b>a</b></p>', '<p><strong>a</strong></p>')).toBe(true)
    expect(sameTextAnswer('a\nb', '<p>a</p><p>b</p>')).toBe(true)
    expect(sameTextAnswer('', '<p></p>')).toBe(true)
    expect(sameTextAnswer('a', '<p><strong>a</strong></p>')).toBe(false)
  })
})

describe('sanitizeRichText in linear time (adversarial input)', () => {
  const timed = (input: string) => {
    const started = performance.now()
    const html = sanitizeRichText(input)
    return { html, ms: performance.now() - started }
  }

  it('sanitizes 40 000 characters of stray „<“ or unknown tags between text in well under 50 ms', () => {
    const inputs = ['<p>' + '<'.repeat(39_997), '<p>' + 'a<x>'.repeat(9_999), '<p>' + 'a<!---->'.repeat(4_999), '<p>' + 'ab<b></b>'.repeat(4_444)]
    for (const input of inputs) timed(input) // warm-up (JIT)
    for (const input of inputs) {
      expect(input.length).toBeLessThanOrEqual(40_000)
      expect(timed(input).ms).toBeLessThan(50)
    }
    expect(timed(inputs[0]!).html).toBe(`<p>${'&lt;'.repeat(39_997)}</p>`)
  })

  it('stays linear for much bigger input', () => {
    timed('<p>' + '<'.repeat(1000))
    expect(timed('<p>' + '<'.repeat(200_000)).ms).toBeLessThan(500)
    expect(timed('<p>' + 'a<x>'.repeat(50_000)).ms).toBeLessThan(500)
  })
})

describe('sanitizeRichText details', () => {
  it('finds the end of a dropped element after characters whose lower case is longer („İ“)', () => {
    expect(sanitizeRichText('İ'.repeat(25) + '<script>SECRET</script>VISIBLE_AFTER')).toBe(`<p>${'İ'.repeat(25)}VISIBLE_AFTER</p>`)
    expect(sanitizeRichText('<p>İstanbul<STYLE>x</Style>Ömer</p>')).toBe('<p>İstanbulÖmer</p>')
  })

  it('ends comments as browsers do', () => {
    expect(sanitizeRichText('<!--> <b>x</b>')).toBe('<p><strong>x</strong></p>')
    expect(sanitizeRichText('a<!--->b')).toBe('<p>ab</p>')
    expect(sanitizeRichText('a<!-- x --!>b')).toBe('<p>ab</p>')
    expect(sanitizeRichText('a<!-- x -- y -->b')).toBe('<p>ab</p>')
    expect(sanitizeRichText('a<!-- offen b')).toBe('<p>a</p>')
  })

  it('keeps the first number of a numbered list (whole numbers 1–999) as the only attribute', () => {
    expect(sanitizeRichText('<ol start="3"><li>c</li><li>d</li></ol>')).toBe('<ol start="3"><li><p>c</p></li><li><p>d</p></li></ol>')
    expect(sanitizeRichText('<ol type="a" START=\'  12 \' onclick="x"><li>l</li></ol>')).toBe('<ol start="12"><li><p>l</p></li></ol>')
    expect(sanitizeRichText('<ol start=999><li>x</li></ol>')).toBe('<ol start="999"><li><p>x</p></li></ol>')
    expect(sanitizeRichText('<ol start="007"><li>x</li></ol>')).toBe('<ol start="7"><li><p>x</p></li></ol>')
    // The first start counts; a start inside another attribute's value is none.
    expect(sanitizeRichText('<ol start="4" start="7"><li>x</li></ol>')).toBe('<ol start="4"><li><p>x</p></li></ol>')
    for (const bad of ['1', '0', '1000', '-2', '3a', '2.5', 'x', '', '&#51;', '3 4']) {
      expect(sanitizeRichText(`<ol start="${bad}"><li>x</li></ol>`)).toBe('<ol><li><p>x</p></li></ol>')
    }
    expect(sanitizeRichText('<ol title="start=5"><li>x</li></ol>')).toBe('<ol><li><p>x</p></li></ol>')
    expect(sanitizeRichText('<ul start="3"><li>x</li></ul>')).toBe('<ul><li><p>x</p></li></ul>')
    const html = '<ol start="5"><li><p>a</p><ol start="2"><li><p>b</p></li></ol></li></ol>'
    expect(sanitizeRichText(html)).toBe(html)
    expect(isRichText('<ol start="5"><li><p>a</p></li></ol>')).toBe(true)
    expect(richTextToPlain(html)).toBe('5. a\n   2. b')
    expect(richTextInlineHtml('<ol start="3"><li><p>c</p></li><li><p>d</p></li></ol>')).toBe('3. c<br>4. d')
  })
})

describe('sanitizeRichText on random input', () => {
  it('only ever answers allowed tags, never a raw < in text, and is idempotent', () => {
    const pieces = [
      '<p>', '</p>', '<ul>', '</ul>', '<ol>', '</ol>', '<li>', '</li>', '<b>', '</b>', '<i>', '</i>', '<u>', '</u>',
      '<br>', '<div>', '</div>', '<script>', '</script>', '<a href="javascript:x">', '</a>', '<!--', '-->', 'text', ' ',
      '&amp;', '&lt;', '<', '>', '"', '<img onerror=x>', '<p style="x">', '<style>', '</style>', '\n', '<h1>', '</h1>',
      '<ol start="3">', '<ol start=x>', '<!-->', '--!>', 'İ',
    ]
    let seed = 42
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    for (let round = 0; round < 500; round++) {
      let input = ''
      const count = Math.floor(random() * 40)
      for (let n = 0; n < count; n++) input += pieces[Math.floor(random() * pieces.length)]
      const html = sanitizeRichText(input)
      expect(html.replace(/<\/?(?:p|ul|ol|li|strong|em|u)>|<br>|<ol start="[1-9]\d{0,2}">/g, '')).not.toMatch(/[<>]/)
      expect(sanitizeRichText(html)).toBe(html)
      if (html) expect(isRichText(html)).toBe(true)
    }
  })

  it('ends a loose list item with the list made for it', () => {
    expect(sanitizeRichText('<li>lose</li>text')).toBe('<ul><li><p>lose</p></li></ul><p>text</p>')
  })

  it('indents nested items in the inline form', () => {
    expect(richTextInlineHtml('<ul><li><p>a</p><ol><li><p>b</p></li></ol></li></ul>')).toBe('• a<br>  1. b')
  })

  it('reopens marks on every line of the inline form and keeps an empty paragraph as an empty line', () => {
    expect(richTextInlineHtml('<p><strong>a<br>b</strong></p>')).toBe('<strong>a</strong><br><strong>b</strong>')
    expect(richTextInlineHtml('<p>a</p><p></p><p>b</p>')).toBe('a<br><br>b')
  })
})
