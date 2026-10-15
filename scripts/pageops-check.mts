// Usage: npx tsx scripts/pageops-check.mts in.pdf
import { readFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { deletePages, extractPages, insertPagesFrom, movePages, parsePageRanges, rotatePages, splitEvery } from '../src/renderer/src/pageOps'

const src = new Uint8Array(readFileSync(process.argv[2]))
const count = async (b: Uint8Array) => (await PDFDocument.load(b)).getPageCount()
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`)
  if (!ok) process.exitCode = 1
}
const n = await count(src)
const sizes = async (b: Uint8Array) => (await PDFDocument.load(b)).getPages().map((p) => Math.round(p.getWidth()))

const rot = await PDFDocument.load(await rotatePages(src, [0], 90))
check(rot.getPage(0).getRotation().angle === 90 && rot.getPage(1 % n).getRotation().angle === 0, 'rotate page 1 by 90')
check((await count(await deletePages(src, [0]))) === n - 1, 'delete one page')
let threw = false
try { await deletePages(src, Array.from({ length: n }, (_, i) => i)) } catch { threw = true }
check(threw, 'refuses to delete every page')
const moved = await movePages(src, [0], n)
check((await count(moved)) === n, 'move keeps page count')
const m2 = await PDFDocument.load(moved)
check(m2.getPage(n - 1).ref.toString() === (await PDFDocument.load(src)).getPage(0).ref.toString() || n === 1, 'move: first page now last')
check((await count(await extractPages(src, [0, 1]))) === 2, 'extract two pages')
const ins = await insertPagesFrom(src, src, 1)
check(ins.count === n && (await count(ins.bytes)) === 2 * n, 'insert whole file at index 1')
const parts = await splitEvery(src, 1)
check(parts.length === n && (await Promise.all(parts.map((p) => count(p.bytes)))).every((c) => c === 1), `split into ${n} single pages`)
check(JSON.stringify(parsePageRanges('1-2, 4, 3-', 5)) === '[0,1,2,3,4]', 'parse ranges')
check((() => { try { parsePageRanges('9', 5); return false } catch { return true } })(), 'range out of bounds rejected')
void sizes
