/**
 * Makes a small tagged test PDF: a heading, a paragraph, a figure with no alternative text and a page number marked as
 * an artefact on page 1; a heading that skips a level and a paragraph on page 2. Usage:
 *   npx tsx scripts/make-tagged-pdf.mts out.pdf [--link] [--lang en-AU] [--title "A title"]
 */
import { writeFileSync } from 'node:fs'
import { buildTaggedPdf } from '../src/renderer/src/tagFixture'

const args = process.argv.slice(2)
const out = args[0]
if (!out) throw new Error('usage: make-tagged-pdf.mts out.pdf [--link] [--lang code] [--title text]')
const value = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined)
writeFileSync(out, await buildTaggedPdf({ untaggedLink: args.includes('--link'), lang: value('--lang'), title: value('--title') }))
