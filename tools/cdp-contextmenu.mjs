// Drive one headless Chrome page over CDP: open a session, dispatch a
// contextmenu on a Markdown link, and report what the plugin rendered.
// Usage: node cdp-contextmenu.mjs <pageUrl> [linkTextFragment]
const [pageUrl, linkText = '萌娘百科'] = process.argv.slice(2)

async function json(path) {
  for (const base of ['http://127.0.0.1:9222', 'http://[::1]:9222']) {
    try {
      const response = await fetch(`${base}${path}`)
      if (response.ok) return response.json()
    } catch {
      // Try the other loopback family.
    }
  }
  throw new Error('no CDP endpoint on 9222')
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      const entry = this.pending.get(message.id)
      if (entry === undefined) return
      this.pending.delete(message.id)
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
      else entry.resolve(message.result)
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
}

const targets = await json('/json/list')
const page = targets.find(target => target.type === 'page')
if (page === undefined) throw new Error('no page target')

const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})
const cdp = new Cdp(socket)
await cdp.send('Runtime.enable')
await cdp.send('Page.enable')

const evaluate = async (expression) => {
  const result = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true, userGesture: true,
  })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

await cdp.send('Page.navigate', { url: pageUrl })
await sleep(4500)

const status = await evaluate(`(() => ({
  title: document.title,
  pluginCss: document.getElementById('dsh-link-actions-style') !== null,
  flow: document.querySelectorAll('[data-chat-flow]').length,
  treeitems: [...document.querySelectorAll('[role=treeitem]')].map(node => node.textContent.trim()).slice(0, 8),
}))()`)
console.log('initial:', JSON.stringify(status))

const opened = await evaluate(`(() => {
  const row = [...document.querySelectorAll('[role=treeitem]')]
    .find(node => node.textContent.includes('DeepSeek'))
  if (!row) return 'no-row'
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    row.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }))
  }
  return 'ok'
})()`)
await sleep(3000)

const afterOpen = await evaluate(`(() => ({
  opened: ${JSON.stringify(opened)},
  flow: document.querySelectorAll('[data-chat-flow]').length,
  anchors: document.querySelectorAll('a[href]').length,
  chatAnchors: document.querySelectorAll('[data-chat-flow] a[href]').length,
}))()`)
console.log('after open:', JSON.stringify(afterOpen))

const probe = await evaluate(`(() => {
  const fragment = ${JSON.stringify(linkText)}
  const anchors = [...document.querySelectorAll('a[href]')]
  const anchor = anchors.find(node => node.textContent.includes(fragment))
  if (!anchor) return { found: false, sample: anchors.slice(0, 5).map(node => node.textContent.trim().slice(0, 30)) }
  const icon = anchor.querySelector('svg') ?? anchor
  const rect = icon.getBoundingClientRect()
  const payload = {
    bubbles: true, cancelable: true, button: 2, buttons: 2,
    clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
  }
  for (const type of ['pointerdown', 'mousedown', 'contextmenu']) {
    icon.dispatchEvent(new MouseEvent(type, payload))
  }
  const menus = [...document.querySelectorAll('.dla-menu')]
  return {
    found: true,
    inFlow: icon.closest('[data-chat-flow]') !== null,
    anchorClosest: (icon.closest('a[href]') !== null),
    targetTag: icon.tagName,
    href: anchor.getAttribute('href'),
    menus: menus.length,
    items: menus.map(menu => [...menu.querySelectorAll('.dla-item')].map(item => item.textContent.trim())),
  }
})()`)
console.log('probe:', JSON.stringify(probe, null, 2))
socket.close()
