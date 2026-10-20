// Report the submenu the "open with" item produces for one file link.
// Usage: node cdp-open-with.mjs <pageUrl> <buttonText>
const [pageUrl, buttonText] = process.argv.slice(2)

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

const opened = await evaluate(`(async () => {
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
  await new Promise(resolve => setTimeout(resolve, 500))
  const item = document.querySelector('[data-dla-action=open-with]')
  if (!item) return { error: 'open-with missing', items: [...document.querySelectorAll('.dla-item')].map(node => node.textContent.trim()) }
  item.click()
  await new Promise(resolve => setTimeout(resolve, 2500))
  const submenu = document.querySelector('.dla-submenu')
  return {
    pending: submenu === null ? null : submenu.textContent.trim(),
    submenuItems: submenu === null ? [] : [...submenu.querySelectorAll('.dla-item')].map(node => ({
      text: node.textContent.trim(),
      disabled: node.disabled,
      icon: node.querySelector('img')?.getAttribute('src') ?? null,
    })),
  }
})()`)
console.log(JSON.stringify(opened, null, 2))
ws.close()
