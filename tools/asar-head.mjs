// Minimal ASAR reader (Chromium Pickle header): list entries or print one file.
// Layout: [u32 4][u32 pickleSize][u32 payloadSize][u32 jsonLength][json][files...]
// Usage: node asar-head.mjs <asar> [entryPath]
import { open } from 'node:fs/promises'

const [asarPath, entryPath] = process.argv.slice(2)
if (!asarPath) {
  console.error('usage: node asar-head.mjs <asar> [entryPath]')
  process.exit(2)
}

const handle = await open(asarPath, 'r')
try {
  const head = Buffer.alloc(16)
  await handle.read(head, 0, 16, 0)
  const pickleSize = head.readUInt32LE(4)
  const jsonLength = head.readUInt32LE(12)
  const jsonBuf = Buffer.alloc(jsonLength)
  await handle.read(jsonBuf, 0, jsonLength, 16)
  const json = JSON.parse(jsonBuf.toString('utf8'))
  const baseOffset = 8 + pickleSize

  if (!entryPath) {
    console.log('files:', Object.keys(json.files ?? {}).join(', '))
    process.exit(0)
  }

  let node = json
  for (const segment of entryPath.split('/').filter(Boolean)) {
    node = node?.files?.[segment]
    if (!node) {
      console.error(`not found: ${entryPath}`)
      process.exit(1)
    }
  }
  if (node.files) {
    console.log('directory:', Object.keys(node.files).join(', '))
    process.exit(0)
  }
  const buffer = Buffer.alloc(Number(node.size))
  await handle.read(buffer, 0, buffer.length, baseOffset + Number(node.offset))
  process.stdout.write(buffer)
} finally {
  await handle.close()
}
