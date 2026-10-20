// End-to-end check of the "save as" item: force the download fallback, click the
// menu item, and report what landed in the download directory.
// Usage: node cdp-save-as.mjs <pageUrl> <downloadDir> [buttonText]
import { readdir } from 'node:fs/promises'

const [pageUrl, downloadDir, buttonText = 'ai-niang-images'] = process.argv.slice(2)

/** Chrome binds either loopback family depending on how it was started. */
async function endpoint() {
  for (const base of ['http://127.0.0.1:9222', 'http://[::1]:9222']) {
    try {
      const response = await fetch(`${base}/json/version`)
      if (response.ok) return base
    } catch {
      // Try the other family.
    }
  }
  throw new Error('no CDP endpoint on 9222')
}

const target = (await (await fetch(`${await endpoint()}/json/list`)).json()).find(entry => entry.type === 'page')
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
let id = 0
const pending = new Map()
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  const resolve = pending.get(message.id)
  if (resolve === undefined) return
  pending.delete(message.id)
  resolve(message.result ?? message)
})
const send = (method, params = {}) => new Promise((resolve) => {
  const callId = ++id
  pending.set(callId, resolve)
  ws.send(JSON.stringify({ id: callId, method, params }))
})
const evaluate = async expression => (await send('Runtime.evaluate', {
  expression, returnByValue: true, awaitPromise: true, userGesture: true,
})).result.value
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

await send('Runtime.enable')
await send('Page.enable')
await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir })
await send('Page.navigate', { url: pageUrl })
await sleep(4500)

await evaluate(`(() => {
  const row = [...document.querySelectorAll('[role=treeitem]')].find(node => node.textContent.includes('DeepSeek'))
  if (!row) return 'no-row'
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    row.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }))
  }
  return 'ok'
})()`)
await sleep(3000)

const files = await evaluate(`(() => [...document.querySelectorAll('[data-chat-flow] button')]
  .filter(node => /file(Mention|Link)/.test(String(node.className)))
  .map(node => ({ text: node.textContent.trim(), title: node.getAttribute('title') })))()`)
console.log('file links:', JSON.stringify(files))

// Force the non-picker path: a native Save-As dialog cannot be driven here.
const result = await evaluate(`(async () => {
  window.showSaveFilePicker = undefined
  const button = [...document.querySelectorAll('[data-chat-flow] button')]
    .find(node => node.textContent.trim() === ${JSON.stringify(buttonText)})
  if (!button) return { error: 'button missing' }
  const rect = button.getBoundingClientRect()
  const payload = {
    bubbles: true, cancelable: true, button: 2, buttons: 2,
    clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
  }
  for (const type of ['pointerdown', 'mousedown', 'contextmenu']) {
    button.dispatchEvent(new MouseEvent(type, payload))
  }
  await new Promise(resolve => setTimeout(resolve, 600))
  const item = document.querySelector('[data-dla-action=save-as]')
  if (!item) return { error: 'save-as missing', items: [...document.querySelectorAll('.dla-item')].map(node => node.textContent.trim()) }
  item.click()
  await new Promise(resolve => setTimeout(resolve, 2500))
  const toast = document.getElementById('dsh-link-actions-toast')
  return { clicked: true, toast: toast === null ? null : toast.textContent, toastShown: toast === null ? false : toast.style.display }
})()`)
console.log('save:', JSON.stringify(result))

await sleep(1500)
try {
  console.log('downloads:', JSON.stringify(await readdir(downloadDir)))
} catch (error) {
  console.log('downloads: <none>', String(error.message))
}
ws.close()
