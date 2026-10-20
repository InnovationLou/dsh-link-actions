/**
 * Link actions for the DSH web client: a context menu on chat Markdown links.
 *
 * The client has no per-link extension point, so this plugin observes the
 * document's `contextmenu` event in the capture phase, recognises the two link
 * shapes the Markdown renderer emits, and draws its own menu:
 *
 *   - `<a href>`            → an ordinary HTTP(S) or navigation anchor.
 *   - `<button>` file link  → `MarkdownFileLink` and inline-code file mentions;
 *                             the renderer puts the full path in `title`.
 *
 * File actions call the existing Session Remote methods, so the plugin needs no
 * transport of its own:
 *   session.canOpenWorkspacePath / workspacePathApplications / openWorkspacePath
 *   workspaceFiles.readBytes (only for "save as")
 *
 * The body runs inside the client module loader's factory closure, which
 * provides `exports`; it is plain ES2022 with no imports.
 */
;(function (exports) {
  'use strict'

  const PLUGIN_ID = 'dsh-link-actions'
  const STYLE_ID = 'dsh-link-actions-style'
  const MENU_ID = 'dsh-link-actions-menu'
  const TOAST_ID = 'dsh-link-actions-toast'

  /** Menu geometry keeps this much room between the card and the viewport. */
  const VIEWPORT_MARGIN = 8
  /** Hover intent delay before a submenu closes again. */
  const SUBMENU_CLOSE_DELAY = 160
  /** Files larger than this are not fetched for "save as"; the Host caps reads too. */
  const MAX_SAVE_BYTES = 64 * 1024 * 1024

  const STRINGS = {
    zh: {
      open: '打开',
      openWith: '打开方式',
      reveal: '在资源管理器中显示',
      copyPath: '复制路径',
      saveAs: '另存为…',
      openInBrowser: '在默认浏览器中打开',
      copyLink: '复制链接',
      loadingApplications: '正在读取可用应用…',
      desktopUnavailable: '当前环境不支持在本机打开文件',
      pathUnresolved: '无法确定这个链接的文件路径',
      copied: '已复制',
      copyFailed: '复制失败',
      openFailed: '打开失败',
      saveFailed: '保存失败',
      saved: '已保存',
      tooLarge: '文件太大，无法另存为',
    },
    en: {
      open: 'Open',
      openWith: 'Open with',
      reveal: 'Show in file manager',
      copyPath: 'Copy path',
      saveAs: 'Save as…',
      openInBrowser: 'Open in browser',
      copyLink: 'Copy link',
      loadingApplications: 'Reading installed applications…',
      desktopUnavailable: 'This environment cannot open files on the host',
      pathUnresolved: 'Could not resolve a file path for this link',
      copied: 'Copied',
      copyFailed: 'Copy failed',
      openFailed: 'Could not open',
      saveFailed: 'Could not save',
      saved: 'Saved',
      tooLarge: 'File is too large to save',
    },
  }

  function strings() {
    return /^zh/i.test(navigator.language || '') ? STRINGS.zh : STRINGS.en
  }

  function errorText(error) {
    return error instanceof Error ? error.message : String(error)
  }

  /**
   * Menu styling borrows the product's own design tokens, so the card follows
   * the active theme instead of guessing colours; every var carries a literal
   * fallback for a host that has not published the token.
   */
  const CSS = `
.dla-menu {
  position: fixed;
  z-index: 2147483000;
  box-sizing: border-box;
  min-width: 188px;
  max-width: 320px;
  padding: 4px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.22));
  border-radius: var(--dsw-radius-lg, 10px);
  background: var(--dsw-menu-surface-fill, Canvas);
  color: var(--dsw-alias-label-primary, CanvasText);
  box-shadow: var(--dsw-elevation-prominent, 0 10px 32px rgba(0, 0, 0, 0.28));
  backdrop-filter: var(--dsw-menu-backdrop-filter, none);
  font: 13px/20px system-ui, -apple-system, 'Segoe UI', sans-serif;
  user-select: none;
}
.dla-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  box-sizing: border-box;
  min-height: 30px;
  padding: 4px 8px;
  border: 0;
  border-radius: var(--dsw-radius-md, 8px);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dla-item:hover:not(:disabled),
.dla-item:focus-visible:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.16));
  outline: none;
}
.dla-item:disabled {
  opacity: 0.45;
  cursor: default;
}
.dla-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dla-icon {
  display: inline-flex;
  flex: none;
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-menu-icon, inherit);
}
.dla-icon img {
  width: 16px;
  height: 16px;
  border-radius: 3px;
  object-fit: contain;
}
.dla-separator {
  height: 1px;
  margin: 4px 6px;
  background: var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.18));
}
.dla-mark {
  flex: none;
  padding-inline-start: 10px;
  color: var(--dsw-alias-label-tertiary, rgba(127, 127, 127, 0.9));
}
.dla-submenu {
  position: fixed;
  z-index: 2147483001;
  max-height: 60vh;
  overflow-y: auto;
}
.dla-toast {
  position: fixed;
  left: 50%;
  bottom: 48px;
  z-index: 2147483002;
  transform: translateX(-50%);
  max-width: 60vw;
  padding: 8px 14px;
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-elevated, rgba(28, 28, 30, 0.94));
  color: var(--dsw-alias-label-primary, #fff);
  box-shadow: var(--dsw-elevation-prominent, 0 8px 24px rgba(0, 0, 0, 0.3));
  font: 13px/20px system-ui, -apple-system, 'Segoe UI', sans-serif;
  pointer-events: none;
}
`

  function injectStyles() {
    if (document.getElementById(STYLE_ID) !== null) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.dataset.plugin = PLUGIN_ID
    style.textContent = CSS
    document.head.appendChild(style)
  }

  /** Transient feedback anchored to the viewport rather than the pointer. */
  let toastTimer = 0
  function toast(message) {
    let node = document.getElementById(TOAST_ID)
    if (node === null) {
      node = document.createElement('div')
      node.id = TOAST_ID
      node.className = 'dla-toast'
      node.setAttribute('role', 'status')
      document.body.appendChild(node)
    }
    node.textContent = message
    node.style.display = 'block'
    window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => { node.style.display = 'none' }, 2600)
  }

  // ---------------------------------------------------------------------------
  // Link recognition
  // ---------------------------------------------------------------------------

  /**
   * Only the conversation transcript owns these links: `data-chat-flow` marks
   * the chat column, so the plugin never takes over a navigation anchor in the
   * rest of the shell. `data-markdown-variant` is only stamped for the compact
   * variant, so it cannot stand alone as the scope marker.
   * @param {Element} node
   */
  function insideChatTranscript(node) {
    return node.closest('[data-chat-flow], [data-markdown-variant]') !== null
  }

  /**
   * The renderer marks file links with a CSS-module class built as
   * `_<local>_<hash>_<line>` — `_fileMention_1ypvv_85` in the shipped build — so
   * the check matches the local name inside the generated token rather than a
   * suffix.
   * @param {Element} element
   */
  function isFileLinkButton(element) {
    if (!(element instanceof HTMLButtonElement)) return false
    for (const token of element.classList) {
      if (token.includes('fileMention') || token.includes('fileLink')) return true
    }
    return false
  }

  /**
   * A file link's path lives in `title` (the renderer's full-path title for
   * mentions, the authored destination for Markdown links) or, failing that,
   * in the visible text, which is the authored token for inline-code mentions.
   * @param {HTMLButtonElement} button
   * @returns {string | undefined}
   */
  function pathOfFileLink(button) {
    const title = (button.getAttribute('title') || '').trim()
    const text = (button.textContent || '').trim()
    const candidate = title !== '' ? title : text
    if (candidate === '' || candidate.length > 4096) return undefined
    return candidate
  }

  /** `C:\…`, `\\server\share`, or a POSIX absolute path. */
  function isAbsolutePath(value) {
    return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value) || value.startsWith('/')
  }

  /**
   * Join a workspace-relative destination onto the Session root. A line suffix
   * (`#L24`, `#L24-L30`) is a navigation parameter, not part of the path.
   * @param {string} raw
   * @param {string | undefined} cwd
   * @returns {string | undefined}
   */
  function absolutePath(raw, cwd) {
    const withoutLine = raw.replace(/#L\d+(?:-L\d+)?$/, '').replace(/^file:\/\/\//i, '')
    let decoded = withoutLine
    try {
      decoded = decodeURI(withoutLine)
    } catch {
      // A malformed escape stays literal; the Host rejects it with its own error.
    }
    decoded = decoded.trim()
    if (decoded === '') return undefined
    if (isAbsolutePath(decoded)) return decoded
    if (cwd === undefined || cwd === '') return undefined
    const base = cwd.replace(/[\\/]+$/, '')
    return `${base}/${decoded.replace(/^\.\//, '')}`
  }

  // ---------------------------------------------------------------------------
  // Menu rendering
  // ---------------------------------------------------------------------------

  /**
   * @typedef {{ kind: 'item', label: string, action?: string, disabled?: boolean,
   *   icon?: Node | null, run?: () => void,
   *   submenu?: MenuItem[] | Promise<MenuItem[]> }} MenuItemNode
   * @typedef {{ kind: 'separator' }} MenuSeparatorNode
   * @typedef {MenuItemNode | MenuSeparatorNode} MenuItem
   */

  function createCard() {
    const card = document.createElement('div')
    card.className = 'dla-menu'
    card.setAttribute('role', 'menu')
    card.dataset.plugin = PLUGIN_ID
    return card
  }

  /** @param {MenuItemNode} item */
  function createRow(item) {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'dla-item'
    row.setAttribute('role', 'menuitem')
    if (item.action !== undefined) row.dataset.dlaAction = item.action
    if (item.disabled === true) row.disabled = true

    if (item.icon !== null && item.icon !== undefined) {
      const icon = document.createElement('span')
      icon.className = 'dla-icon'
      icon.appendChild(item.icon)
      row.appendChild(icon)
    }

    const label = document.createElement('span')
    label.className = 'dla-label'
    label.textContent = item.label
    row.appendChild(label)
    return row
  }

  /** Clamp a card inside the viewport, flipping horizontally when the pointer sits near an edge. */
  function placeCard(card, x, y, preferLeft) {
    card.style.visibility = 'hidden'
    card.style.left = '0px'
    card.style.top = '0px'
    const width = card.offsetWidth
    const height = card.offsetHeight
    const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN)
    const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN)
    const preferredLeft = preferLeft ? x - width : x
    const left = preferredLeft < VIEWPORT_MARGIN ? Math.min(x, maxLeft) : preferredLeft
    const top = y > maxTop ? Math.max(VIEWPORT_MARGIN, y - height) : y
    card.style.left = `${Math.round(Math.max(VIEWPORT_MARGIN, Math.min(left, maxLeft)))}px`
    card.style.top = `${Math.round(Math.max(VIEWPORT_MARGIN, Math.min(top, maxTop)))}px`
    card.style.visibility = 'visible'
  }

  /**
   * One open menu: its card, at most one submenu, dismissal listeners, and the
   * item list it renders. Opening again replaces the previous menu.
   */
  class Menu {
    constructor() {
      this.card = null
      this.submenu = null
      this.submenuOwner = null
      this.closeTimer = 0
      this.removers = []
      this.onPointerDown = (event) => {
        if (this.owns(event.target)) return
        this.close()
      }
      this.onKeyDown = (event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return
        event.preventDefault()
        event.stopPropagation()
        this.close()
      }
      this.onViewportChange = () => { this.close() }
    }

    /** @param {EventTarget | null} node */
    owns(node) {
      return node instanceof Node && (this.card?.contains(node) === true || this.submenu?.contains(node) === true)
    }

    /**
     * @param {MenuItem[]} items
     * @param {number} x
     * @param {number} y
     */
    open(items, x, y) {
      this.close()
      const card = createCard()
      card.id = MENU_ID
      this.card = card
      this.fill(card, items)
      document.body.appendChild(card)
      placeCard(card, x, y, false)
      this.listen()
      const first = card.querySelector('.dla-item:not(:disabled)')
      if (first instanceof HTMLElement) first.focus({ preventScroll: true })
    }

    /**
     * @param {HTMLElement} card
     * @param {MenuItem[]} items
     */
    fill(card, items) {
      for (const item of items) {
        if (item.kind === 'separator') {
          const line = document.createElement('div')
          line.className = 'dla-separator'
          line.setAttribute('role', 'separator')
          card.appendChild(line)
          continue
        }
        const row = createRow(item)
        if (item.submenu !== undefined && item.disabled !== true) {
          const mark = document.createElement('span')
          mark.className = 'dla-mark'
          mark.textContent = '›'
          // Decorative: the row's accessible name must stay the action label.
          mark.setAttribute('aria-hidden', 'true')
          row.appendChild(mark)
          const open = () => { void this.showSubmenu(row, item.submenu) }
          row.addEventListener('pointerenter', open)
          row.addEventListener('focus', open)
        }
        row.addEventListener('click', () => {
          if (item.disabled === true) return
          // A submenu row stays open: pointer hover and a click are the same
          // intent, and a click that closed the menu would swallow the choice.
          if (item.submenu !== undefined) {
            void this.showSubmenu(row, item.submenu)
            return
          }
          if (item.run === undefined) return
          this.close()
          item.run()
        })
        card.appendChild(row)
      }
      card.addEventListener('pointerenter', () => { this.cancelSubmenuClose() })
    }

    /**
     * @param {HTMLElement} owner
     * @param {MenuItem[] | Promise<MenuItem[]>} source
     */
    async showSubmenu(owner, source) {
      this.cancelSubmenuClose()
      if (this.submenuOwner === owner && this.submenu !== null) return
      this.hideSubmenu()
      const panel = createCard()
      panel.removeAttribute('id')
      panel.classList.add('dla-submenu')
      this.submenu = panel
      this.submenuOwner = owner
      document.body.appendChild(panel)
      this.positionSubmenu(panel, owner)

      panel.addEventListener('pointerleave', (event) => {
        if (event.relatedTarget instanceof Node && owner.contains(event.relatedTarget)) return
        this.scheduleSubmenuClose()
      })
      owner.addEventListener('pointerleave', (event) => {
        if (event.relatedTarget instanceof Node && panel.contains(event.relatedTarget)) return
        this.scheduleSubmenuClose()
      })

      if (Array.isArray(source)) {
        this.fill(panel, source)
        this.positionSubmenu(panel, owner)
        return
      }
      const pending = createRow({ kind: 'item', label: strings().loadingApplications, disabled: true })
      panel.appendChild(pending)
      this.positionSubmenu(panel, owner)
      const items = await source
      if (this.submenu !== panel) return
      // A directory has no per-application handlers, and a file with no
      // association has none either: the row disappears rather than offering a
      // choice that cannot exist.
      if (items.length === 0) {
        panel.remove()
        this.submenu = null
        this.submenuOwner = null
        owner.remove()
        return
      }
      panel.replaceChildren()
      this.fill(panel, items)
      this.positionSubmenu(panel, owner)
    }

    /**
     * A submenu sits beside the whole card, never over the row that opened it:
     * hovering a row opens the submenu, and a panel covering that row would
     * swallow the pointer that is already there.
     * @param {HTMLElement} panel
     * @param {HTMLElement} _owner
     */
    positionSubmenu(panel, _owner) {
      const card = this.card
      const width = panel.offsetWidth
      const rect = card === null ? { left: 0, right: VIEWPORT_MARGIN, top: 0 } : card.getBoundingClientRect()
      const leftSide = rect.left - width - 2
      const preferLeft = rect.right + width + VIEWPORT_MARGIN * 2 > window.innerWidth && leftSide >= VIEWPORT_MARGIN
      placeCard(panel, preferLeft ? leftSide : rect.right + 2, rect.top, false)
    }

    scheduleSubmenuClose() {
      this.cancelSubmenuClose()
      this.closeTimer = window.setTimeout(() => { this.hideSubmenu() }, SUBMENU_CLOSE_DELAY)
    }

    cancelSubmenuClose() {
      window.clearTimeout(this.closeTimer)
      this.closeTimer = 0
    }

    hideSubmenu() {
      this.submenu?.remove()
      this.submenu = null
      this.submenuOwner = null
    }

    listen() {
      document.addEventListener('pointerdown', this.onPointerDown, true)
      document.addEventListener('keydown', this.onKeyDown, true)
      window.addEventListener('scroll', this.onViewportChange, true)
      window.addEventListener('resize', this.onViewportChange)
      window.addEventListener('blur', this.onViewportChange)
      this.removers = [
        () => { document.removeEventListener('pointerdown', this.onPointerDown, true) },
        () => { document.removeEventListener('keydown', this.onKeyDown, true) },
        () => { window.removeEventListener('scroll', this.onViewportChange, true) },
        () => { window.removeEventListener('resize', this.onViewportChange) },
        () => { window.removeEventListener('blur', this.onViewportChange) },
      ]
    }

    close() {
      this.cancelSubmenuClose()
      this.hideSubmenu()
      this.card?.remove()
      this.card = null
      for (const remove of this.removers) remove()
      this.removers = []
    }
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /** @param {any} result */
  function remoteFailureText(result) {
    const error = result?.error
    return typeof error?.message === 'string' && error.message !== '' ? error.message : undefined
  }

  /**
   * The Session whose conversation holds this link: the main-viewed one, or the
   * only Session the store knows.
   * @param {any} ctx
   * @returns {{ id: string, cwd: string | undefined } | undefined}
   */
  function activeSession(ctx) {
    try {
      const rows = ctx.sessions.list.getSnapshot().byId
      for (const [id, row] of Object.entries(rows)) {
        if (((row?.retainedBy?.mainView) ?? 0) > 0) return { id, cwd: row?.cwd }
      }
      const first = Object.entries(rows)[0]
      return first === undefined ? undefined : { id: first[0], cwd: first[1]?.cwd }
    } catch {
      return undefined
    }
  }

  /** @param {string} text */
  async function copyText(text) {
    if (navigator.clipboard?.writeText !== undefined) {
      await navigator.clipboard.writeText(text)
      return
    }
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    document.execCommand('copy')
    area.remove()
  }

  /**
   * Read a service this plugin does not require: `ctx.remote.<ns>` throws for an
   * undeclared namespace, while a non-strict reflect read returns the provider
   * when the deployment mounted it and nothing otherwise. Keeping the namespace
   * out of `inject` means a deployment without file reads still gets the menus.
   * @param {any} ctx
   * @param {string} name
   */
  function optionalService(ctx, name) {
    try {
      return ctx.reflect?.get(name, false)
    } catch {
      return undefined
    }
  }

  /**
   * Fetch the file's bytes and hand them to the browser's save flow: the File
   * System Access picker when the runtime offers it (a real Save-As dialog),
   * otherwise an object-URL download.
   * @param {any} ctx
   * @param {{ id: string }} session
   * @param {string} path
   */
  async function saveFileAs(ctx, session, path) {
    const files = optionalService(ctx, 'remote.workspaceFiles')
    if (files === undefined) throw new Error('workspaceFiles remote is unavailable')
    const basename = path.split(/[\\/]/).pop() || 'download'

    // Open the picker before the round-trip: a browser only grants it while the
    // click's user activation is still live.
    const handle = typeof window.showSaveFilePicker === 'function'
      ? await window.showSaveFilePicker({ suggestedName: basename })
      : null

    const result = await files.readBytes(session.id, path, {})
    if (result?.ok !== true) throw new Error(remoteFailureText(result) ?? 'read failed')
    const data = result.value?.data
    const length = data?.byteLength ?? 0
    if (length > MAX_SAVE_BYTES) throw new Error('too large')
    const blob = new Blob([data], { type: 'application/octet-stream' })

    if (handle !== null) {
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return
    }
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = basename
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => { URL.revokeObjectURL(url) }, 60_000)
  }

  /** @param {any} ctx */
  function createActions(ctx) {
    const text = strings()
    let desktop = undefined

    async function desktopAvailable() {
      if (desktop !== undefined) return desktop
      try {
        const result = await ctx.remote.session.canOpenWorkspacePath()
        desktop = result?.ok === true && result.value === true
      } catch {
        desktop = false
      }
      return desktop
    }

    /**
     * @param {string} path
     * @param {'open' | 'reveal'} action
     * @param {string | undefined} [application]
     */
    async function openPath(path, action, application) {
      const request = action === 'reveal'
        ? { path, action: 'reveal' }
        : (application === undefined ? { path } : { path, application })
      const result = await ctx.remote.session.openWorkspacePath(request)
      if (result?.ok !== true) throw new Error(remoteFailureText(result) ?? 'open failed')
    }

    /** @param {string} path */
    async function applications(path) {
      try {
        const result = await ctx.remote.session.workspacePathApplications({ path })
        if (result?.ok !== true) return []
        return Array.isArray(result.value) ? result.value : []
      } catch {
        return []
      }
    }

    return { text, desktopAvailable, openPath, applications }
  }

  /** @param {{ id?: string }} application */
  function iconFor(application) {
    if (application.id === undefined || application.id === '') return null
    const image = document.createElement('img')
    image.alt = ''
    image.loading = 'lazy'
    image.src = new URL(`open-in-app/icon/${encodeURIComponent(application.id)}`, location.href).href
    image.addEventListener('error', () => {
      // A missing bundle icon must not leave an empty gutter: the row's label
      // starts at the card edge instead of after an invisible slot.
      image.parentElement?.remove()
    })
    return image
  }

  // ---------------------------------------------------------------------------
  // Menu composition
  // ---------------------------------------------------------------------------

  /**
   * @param {any} ctx
   * @param {Menu} menu
   * @param {ReturnType<typeof createActions>} actions
   * @param {string} path
   * @param {{ id: string, cwd: string | undefined } | undefined} session
   */
  function showFileMenu(ctx, menu, actions, path, session, x, y) {
    const text = actions.text
    const absolute = absolutePath(path, session?.cwd)
    /** @type {MenuItem[]} */
    const items = []

    const failure = (verb) => (error) => { toast(`${verb}: ${errorText(error)}`) }

    if (absolute !== undefined) {
      items.push({
        kind: 'item', action: 'open', label: text.open,
        run: () => { void actions.openPath(absolute, 'open').catch(failure(text.openFailed)) },
      })
      items.push({
        kind: 'item', action: 'open-with', label: text.openWith,
        // Fetched lazily: native application discovery is slow enough that the
        // card should still open on the press.
        submenu: actions.applications(absolute).then(apps => apps.map(application => ({
          kind: 'item',
          label: application.name ?? application.id,
          icon: iconFor(application),
          run: () => { void actions.openPath(absolute, 'open', application.id).catch(failure(text.openFailed)) },
        }))),
      })
      items.push({ kind: 'separator' })
      items.push({
        kind: 'item', action: 'reveal', label: text.reveal,
        run: () => { void actions.openPath(absolute, 'reveal').catch(failure(text.openFailed)) },
      })
    }

    items.push({
      kind: 'item', action: 'copy-path', label: text.copyPath,
      run: () => {
        void copyText(absolute ?? path).then(() => toast(text.copied)).catch(() => toast(text.copyFailed))
      },
    })

    if (absolute !== undefined) {
      items.push({
        kind: 'item', action: 'save-as', label: text.saveAs,
        run: () => {
          if (session === undefined) {
            toast(text.pathUnresolved)
            return
          }
          void saveFileAs(ctx, session, absolute).then(() => toast(text.saved)).catch((error) => {
            if (error instanceof DOMException && error.name === 'AbortError') return
            const message = errorText(error)
            toast(message === 'too large' ? text.tooLarge : `${text.saveFailed}: ${message}`)
          })
        },
      })
    }

    menu.open(items, x, y)

    // Only reveal desktop-only failure after the card exists, so a plain Web
    // host still offers "copy path" instead of an empty menu.
    if (absolute !== undefined) {
      void actions.desktopAvailable().then((available) => {
        if (available || menu.card === null) return
        for (const row of menu.card.querySelectorAll('.dla-item')) {
          row.disabled = true
        }
        toast(text.desktopUnavailable)
      })
    }
  }

  /** @param {Menu} menu @param {string} url */
  function showLinkMenu(menu, url, x, y) {
    const text = strings()
    let protocol = ''
    try {
      protocol = new URL(url).protocol
    } catch {
      protocol = ''
    }
    /** @type {MenuItem[]} */
    const items = []
    if (protocol === 'http:' || protocol === 'https:') {
      items.push({
        kind: 'item', action: 'open-browser', label: text.openInBrowser,
        run: () => { window.open(url, '_blank', 'noopener,noreferrer') },
      })
    }
    items.push({
      kind: 'item', action: 'copy-link', label: text.copyLink,
      run: () => { void copyText(url).then(() => toast(text.copied)).catch(() => toast(text.copyFailed)) },
    })
    menu.open(items, x, y)
  }

  /** @param {any} ctx */
  function install(ctx) {
    injectStyles()
    const menu = new Menu()
    const actions = createActions(ctx)

    const onContextMenu = (event) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (menu.owns(target)) return
      if (!insideChatTranscript(target)) return

      const anchor = target.closest('a[href]')
      if (anchor !== null) {
        event.preventDefault()
        event.stopPropagation()
        showLinkMenu(menu, anchor.getAttribute('href') || '', event.clientX, event.clientY)
        return
      }

      const button = target.closest('button')
      if (button === null || !isFileLinkButton(button)) return
      const path = pathOfFileLink(button)
      if (path === undefined) return
      event.preventDefault()
      event.stopPropagation()
      showFileMenu(ctx, menu, actions, path, activeSession(ctx), event.clientX, event.clientY)
    }

    document.addEventListener('contextmenu', onContextMenu, true)
    return () => {
      document.removeEventListener('contextmenu', onContextMenu, true)
      menu.close()
      document.getElementById(STYLE_ID)?.remove()
      document.getElementById(TOAST_ID)?.remove()
    }
  }

  exports.inject = ['remote', 'remote.session', 'sessions']

  /** @param {any} ctx */
  exports.apply = function apply(ctx) {
    ctx.effect(() => {
      const dispose = install(ctx)
      console.info('[dsh-link-actions] link context menus ready')
      return () => {
        dispose()
        console.info('[dsh-link-actions] link context menus disposed')
      }
    }, 'dsh-link-actions: link context menus')
  }
})(exports)
