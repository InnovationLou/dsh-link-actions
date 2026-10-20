// Drive one headless Chrome page over CDP: dispatch a contextmenu on the
// transcript's file link and report the rendered items after the lazy
// application query settles.
// Usage: node cdp-file-menu.mjs <pageUrl> [buttonText]
const [pageUrl, buttonText = 'ai-niang-images'] = process.argv.slice(2)

async function endpoint() {
  for (const base of ['http://127.0.0.1:9222', 'http://[::1]:9222']) {
    try {
      const response = await fetch(`${base}/json/version`)
      if (response.ok) return base
    } catch {
      // Try the other loopback family.
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
  resolve(message.result)
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

const probe = await evaluate(`(() => {
  const button = [...document.querySelectorAll('[data-chat-flow] button')]
    .find(node => node.textContent.trim() === ${JSON.stringify(buttonText)})
  if (!button) return { found: false }
  const rect = button.getBoundingClientRect()
  const payload = {
    bubbles: true, cancelable: true, button: 2, buttons: 2,
    clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
  }
  for (const type of ['pointerdown', 'mousedown', 'contextmenu']) {
    button.dispatchEvent(new MouseEvent(type, payload))
  }
  return { found: true, title: button.getAttribute('title'), pages: document.querySelectorAll('.dla-menu').length }
})()`)

await sleep(1800)

const settled = await evaluate(`(() => ({
  menus: [...document.querySelectorAll('.dla-menu')].map(menu => ({
    items: [...menu.querySelectorAll('.dla-item')].map(item => ({ text: item.textContent.trim(), disabled: item.disabled })),
  })),
}))()`)

console.log(JSON.stringify({ probe, settled }, null, 2))
ws.close()
