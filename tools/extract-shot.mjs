// Extract the last screenshot from a spill-formatted capture_browser_scenario result.
// Usage: node extract-shot.mjs <spill.txt> <out.png>
import { readFile, writeFile } from 'node:fs/promises'

const [input, output] = process.argv.slice(2)
const text = await readFile(input, 'utf8')
const marker = '"data_base64":"'
let index = text.lastIndexOf(marker)
if (index < 0) throw new Error('no screenshot payload found')
index += marker.length
const end = text.indexOf('"', index)
const base64 = text.slice(index, end)
await writeFile(output, Buffer.from(base64, 'base64'))
console.log(`wrote ${output} (${base64.length} base64 chars)`)
