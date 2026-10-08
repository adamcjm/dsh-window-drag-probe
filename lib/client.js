/**
 * Client half of dsh-window-drag-probe.
 *
 * Purpose (deepseek-harness discussion #9112): on macOS the DSH Desktop window
 * is a `hiddenInset` window with no native title bar, so dragging can only come
 * from `-webkit-app-region: drag` boxes the page declares. On the reporting
 * machine none of them drag, including the ones that carry `data-window-drag`.
 *
 * This probe answers, from inside the real window, the questions that cannot be
 * answered from outside it:
 *
 *   1. does the darwin platform marker reach the document at all;
 *   2. does the engine actually resolve `-webkit-app-region` here (computed value
 *      `drag`/`no-drag`, or empty when the property is not honoured);
 *   3. which drag/no-drag boxes exist and what the project's own composition
 *      model (ui-web window-drag/regions.ts: last box in document order wins)
 *      says about a few points on the chrome rows;
 *   4. does the window move when the user drags it — reported live from
 *      `window.screenX/screenY`, which is the only in-page witness of a window
 *      move;
 *   5. is the recall mark (`data-window-drag-recall`, which subtracts the whole
 *      window when left set) stuck on.
 *
 * It also offers a manual top drag band, inline-styled so it wins over the
 * shell's `body > :not(#root)` subtraction, so the reporter can tell "no drag
 * region covers the top strip" apart from "the native window ignores every drag
 * region".
 */

window.__ModuleLoader__.load({
  id: 'dsh-window-drag-probe',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    /** Panel element id, also the idempotence guard. */
    const PANEL_ID = 'dsh-window-drag-probe-panel'
    /** The mark a chrome row puts on the element that owns its window drag. */
    const DRAG_MARK = 'data-window-drag'
    /** The one-frame pulse attribute the shell sets on body. */
    const RECALL_MARK = 'data-window-drag-recall'
    /** Points the probe reports on, in viewport CSS pixels. */
    const SAMPLES = [
      { label: '侧边栏 topStrip 空白 (150,44)', x: 150, y: 44 },
      { label: '侧边栏 logoRow (106,71)', x: 106, y: 71 },
      { label: '窗口最顶端 (640,4)', x: 640, y: 4 },
    ]
    /** Row heights of the draggability matrix, from the window's top edge down. */
    const SCAN_Y = [4, 20, 36, 52, 68, 84]
    /** Columns of the draggability matrix, across the whole window width. */
    const SCAN_X = [40, 140, 240, 400, 640, 900]

    /** Collected state, refreshed on every re-collect. */
    const state = {
      platform: '',
      propertyHonoured: false,
      recallSet: false,
      recallPulses: 0,
      regions: [],
      rows: [],
      bodyExtras: [],
      windowX: 0,
      windowY: 0,
      moves: [],
      injected: false,
    }

    /** Read every visible box whose computed app-region is not `none`. */
    function collectRegions() {
      const out = []
      for (const element of Array.from(document.querySelectorAll('*'))) {
        const style = getComputedStyle(element)
        const region = style.getPropertyValue('-webkit-app-region')
        if (region !== 'drag' && region !== 'no-drag') continue
        if (style.visibility === 'hidden' || style.display === 'none') continue
        const rect = element.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) continue
        out.push({
          tag: element.tagName,
          cls: String(element.className).slice(0, 48),
          region,
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        })
      }
      return out
    }

    /** The project's composition model: the last box containing a point decides. */
    function draggableAt(regions, x, y) {
      let draggable = false
      for (const region of regions) {
        if (x >= region.x && x < region.x + region.w && y >= region.y && y < region.y + region.h) {
          draggable = region.region === 'drag'
        }
      }
      return draggable
    }

    /** Refresh every collected value. */
    function collect() {
      state.platform = document.documentElement.dataset.platform ?? '(unset)'
      state.regions = collectRegions()
      // The raw computed values are the decisive evidence: an engine that does not
      // honour the property reports an empty string, and a shell rule that lost the
      // cascade shows up as `no-drag` on the row instead of `drag`.
      const firstRow = document.querySelector(`[${DRAG_MARK}]`)
      state.bodyRegionValue = getComputedStyle(document.body).getPropertyValue('-webkit-app-region') || '(empty)'
      state.rowRegionValue = firstRow === null
        ? '(no [data-window-drag] row)'
        : (getComputedStyle(firstRow).getPropertyValue('-webkit-app-region') || '(empty)')
      state.propertyHonoured = state.rowRegionValue === 'drag'
      state.recallSet = document.body.hasAttribute(RECALL_MARK)
      state.rows = Array.from(document.querySelectorAll(`[${DRAG_MARK}]`)).map((element) => {
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return {
          cls: String(element.className).slice(0, 40) || element.tagName,
          region: style.getPropertyValue('-webkit-app-region') || '(none)',
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        }
      })
      state.bodyExtras = Array.from(document.body.children)
        .filter((element) => element.id !== 'root')
        .map((element) => {
          const rect = element.getBoundingClientRect()
          // A body child that covers the window is what `body > :not(#root)` turns
          // into a window-wide no-drag box, which erases every drag row under it.
          const region = getComputedStyle(element).getPropertyValue('-webkit-app-region') || '(none)'
          return `${element.tagName}${element.id === '' ? '' : '#' + element.id} ${Math.round(rect.width)}x${Math.round(rect.height)} @${Math.round(rect.x)},${Math.round(rect.y)} app-region=${region}`
        })
      state.windowX = window.screenX
      state.windowY = window.screenY
    }

    /** Panel styles, kept inline so no shell rule can move or hide it. */
    const PANEL_CSS = [
      'position:fixed', 'right:10px', 'bottom:10px', 'z-index:2147483600',
      'width:min(560px,46vw)', 'max-height:78vh',
      'display:flex', 'flex-direction:column',
      'background:rgba(16,18,24,.94)', 'color:#d8e2f0',
      'font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace',
      'padding:10px 12px', 'border:1px solid #3b4457', 'border-radius:8px',
      'box-shadow:0 6px 24px rgba(0,0,0,.45)',
      'user-select:text', '-webkit-app-region:no-drag',
    ].join(';')

    /** Where the panel remembers its own position and collapsed state. */
    const POS_KEY = 'dsh-window-drag-probe:pos'
    const COLLAPSED_KEY = 'dsh-window-drag-probe:collapsed'
    /** The top drag band's element id. */
    const BAND_ID = 'dsh-window-drag-probe-band'
    /** Tall enough to grab without hunting for it. */
    const BAND_HEIGHT = 16
    /** A draggable region swallows pointer events, so a hover cue is impossible: the
     * band rests faintly visible instead, which is also how the user finds it. */
    const BAND_FILL = 'rgba(138,180,255,0.14)'

    /** Render the current state into the panel body. */
    function render(body) {
      const dragCount = state.regions.filter((region) => region.region === 'drag').length
      const lines = []
      lines.push(`platform: ${state.platform}`)
      lines.push(`computed app-region · body: ${state.bodyRegionValue}`)
      lines.push(`computed app-region · 首个 [data-window-drag] 行: ${state.rowRegionValue}`)
      lines.push(`判定: ${state.propertyHonoured ? '该行解析为 drag ✓' : '该行不是 drag ✗（属性未被支持，或被更高优先级的 no-drag 规则盖住）'}`)
      lines.push(`recall 标记当前: ${state.recallSet ? '已设置（整窗拖拽被减掉）' : '未设置'}`)
      lines.push(`recall 脉冲次数（本次加载以来）: ${state.recallPulses}`)
      lines.push(`窗口位置: ${state.windowX}, ${state.windowY}   ← 拖动窗口时这里会变`)
      lines.push(`窗口移动记录: ${state.moves.length === 0 ? '无（尚未检测到窗口被拖动）' : state.moves.slice(-6).join(' | ')}`)
      lines.push('')
      lines.push(`drag 行 (${state.rows.length}):`)
      for (const row of state.rows) {
        lines.push(`  ${row.cls}  ${row.w}x${row.h} @${row.x},${row.y}  app-region=${row.region}`)
      }
      lines.push('')
      lines.push(`app-region 盒子: ${state.regions.length} 个（drag ${dragCount} / no-drag ${state.regions.length - dragCount}）`)
      for (const region of state.regions.slice(0, 12)) {
        lines.push(`  ${region.region.padEnd(7)} ${region.tag} ${region.w}x${region.h} @${region.x},${region.y} ${region.cls}`)
      }
      lines.push('')
      lines.push('顶部可拖性矩阵（■=可拖 ·=不可拖；列=x，行=y）:')
      lines.push('        ' + SCAN_X.map((x) => String(x).padStart(6)).join(''))
      for (const y of SCAN_Y) {
        const cells = SCAN_X.map((x) => (draggableAt(state.regions, x, y) ? '     ■' : '     ·')).join('')
        lines.push(`  y=${String(y).padStart(2)}${cells}`)
      }
      lines.push('')
      lines.push('采样点命中链（DOM 顺序，最后一条决定该点）:')
      for (const sample of SAMPLES) {
        const hits = state.regions.filter((region) => sample.x >= region.x && sample.x < region.x + region.w
          && sample.y >= region.y && sample.y < region.y + region.h)
        lines.push(`  ${sample.label} → ${draggableAt(state.regions, sample.x, sample.y) ? '可拖' : '不可拖'}`)
        if (hits.length === 0) lines.push('      (没有任何 app-region 盒子包含该点)')
        // The tail of the chain is what wins: name it, so the eraser is identifiable.
        for (const hit of hits.slice(-4)) {
          lines.push(`      ${hit.region.padEnd(7)} ${hit.tag} ${hit.w}x${hit.h} @${hit.x},${hit.y} ${hit.cls}`)
        }
      }
      lines.push('')
      lines.push(`body 直属子元素（除 #root）: ${state.bodyExtras.length === 0 ? '无' : state.bodyExtras.join(' ; ')}`)
      lines.push(`手动拖拽带: ${state.injected ? '已插入（窗口顶部 10px）' : '未插入'}`)
      body.textContent = lines.join('\n')
    }

    /** Build the panel, its refresh loop and its buttons. */
    function mountPanel() {
      const panel = document.createElement('div')
      panel.id = PANEL_ID
      panel.style.cssText = PANEL_CSS

      // The header row is the panel's own drag handle. It deliberately carries no
      // `-webkit-app-region`: that would move the window instead of the panel.
      const title = document.createElement('div')
      title.style.cssText = 'display:flex;align-items:center;gap:6px;flex:none;margin-bottom:6px;cursor:move;user-select:none'
      const grip = document.createElement('span')
      grip.textContent = '⠿'
      grip.style.cssText = 'color:#6b7690;font-size:13px;line-height:1'
      const label = document.createElement('span')
      label.textContent = 'DSH 窗口拖动诊断 · 按住此行拖动'
      label.style.cssText = 'font-weight:600;color:#8ab4ff;flex:1;pointer-events:none'
      const collapse = document.createElement('button')
      collapse.type = 'button'
      collapse.title = '折叠 / 展开'
      collapse.style.cssText = 'font:inherit;padding:1px 6px;border-radius:5px;border:1px solid #46506a;background:#222836;color:#d8e2f0;cursor:pointer'
      title.append(grip, label, collapse)
      panel.append(title)

      const body = document.createElement('div')
      body.style.cssText = 'overflow:auto;flex:1;min-height:0;white-space:pre-wrap'
      panel.append(body)

      const bar = document.createElement('div')
      bar.style.cssText = 'margin-top:8px;display:flex;gap:6px;flex-wrap:wrap'
      const button = (label, onClick) => {
        const element = document.createElement('button')
        element.type = 'button'
        element.textContent = label
        element.style.cssText = 'font:inherit;padding:3px 8px;border-radius:5px;border:1px solid #46506a;background:#222836;color:#d8e2f0;cursor:pointer'
        element.addEventListener('click', onClick)
        return element
      }

      bar.append(button('重新采集', () => { collect(); render(body) }))
      bar.append(button('插入顶部拖拽带', () => { toggleBand(true); collect(); render(body) }))
      bar.append(button('移除拖拽带', () => { toggleBand(false); collect(); render(body) }))
      bar.append(button('复位位置', () => {
        panel.style.left = ''
        panel.style.top = ''
        panel.style.right = '10px'
        panel.style.bottom = '10px'
        try { localStorage.removeItem(POS_KEY) } catch { /* private mode */ }
      }))
      bar.append(button('隐藏面板', () => { panel.remove() }))
      panel.append(bar)
      document.body.append(panel)

      // Restore the remembered corner; the first drag switches to left/top.
      try {
        const saved = JSON.parse(localStorage.getItem(POS_KEY) ?? 'null')
        if (saved !== null && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
          panel.style.left = `${saved.left}px`
          panel.style.top = `${saved.top}px`
          panel.style.right = 'auto'
          panel.style.bottom = 'auto'
        }
      } catch { /* unreadable storage keeps the default corner */ }

      // Panel dragging: pointer capture keeps the gesture on the handle even when the
      // pointer leaves it, and the clamp keeps the whole panel reachable.
      let dragX = 0
      let dragY = 0
      let dragging = false
      title.addEventListener('pointerdown', (event) => {
        if (event.target instanceof Element && event.target.closest('button') !== null) return
        const rect = panel.getBoundingClientRect()
        panel.style.left = `${rect.left}px`
        panel.style.top = `${rect.top}px`
        panel.style.right = 'auto'
        panel.style.bottom = 'auto'
        dragX = event.clientX - rect.left
        dragY = event.clientY - rect.top
        dragging = true
        title.setPointerCapture(event.pointerId)
        event.preventDefault()
      })
      title.addEventListener('pointermove', (event) => {
        if (!dragging) return
        const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth)
        const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight)
        panel.style.left = `${Math.min(Math.max(0, event.clientX - dragX), maxLeft)}px`
        panel.style.top = `${Math.min(Math.max(0, event.clientY - dragY), maxTop)}px`
      })
      const endDrag = (event) => {
        if (!dragging) return
        dragging = false
        try { title.releasePointerCapture(event.pointerId) } catch { /* already released */ }
        try {
          localStorage.setItem(POS_KEY, JSON.stringify({ left: panel.offsetLeft, top: panel.offsetTop }))
        } catch { /* private mode: the position is simply not remembered */ }
      }
      title.addEventListener('pointerup', endDrag)
      title.addEventListener('pointercancel', endDrag)

      // Collapsing leaves only the handle row, so the panel can stay out of the way.
      const applyCollapsed = (collapsed) => {
        body.style.display = collapsed ? 'none' : ''
        bar.style.display = collapsed ? 'none' : 'flex'
        collapse.textContent = collapsed ? '▸' : '▾'
        collapse.title = collapsed ? '展开' : '折叠'
        try {
          if (collapsed) localStorage.setItem(COLLAPSED_KEY, '1')
          else localStorage.removeItem(COLLAPSED_KEY)
        } catch { /* private mode */ }
      }
      collapse.addEventListener('click', () => { applyCollapsed(body.style.display !== 'none') })
      try { applyCollapsed(localStorage.getItem(COLLAPSED_KEY) === '1') } catch { applyCollapsed(false) }

      state.moves = []
      // window.screenX/screenY is the only in-page witness of a native window move.
      const timer = window.setInterval(() => {
        if (!panel.isConnected) { window.clearInterval(timer); return }
        const x = window.screenX
        const y = window.screenY
        if (x !== state.windowX || y !== state.windowY) {
          state.moves.push(`${state.windowX},${state.windowY} → ${x},${y}`)
          state.windowX = x
          state.windowY = y
          render(body)
        }
        if (document.body.hasAttribute(RECALL_MARK) !== state.recallSet) {
          state.recallSet = document.body.hasAttribute(RECALL_MARK)
          if (state.recallSet) state.recallPulses += 1
          render(body)
        }
      }, 400)

      // Count recall pulses so a stuck mark is visible as a flat state, not a count.
      const observer = new MutationObserver(() => {
        if (document.body.hasAttribute(RECALL_MARK)) state.recallPulses += 1
      })
      observer.observe(document.body, { attributes: true, attributeFilter: [RECALL_MARK] })

      // A resized window must not strand the panel outside the viewport.
      const keepInView = () => {
        if (panel.style.left === '') return
        const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth)
        const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight)
        panel.style.left = `${Math.min(Math.max(0, panel.offsetLeft), maxLeft)}px`
        panel.style.top = `${Math.min(Math.max(0, panel.offsetTop), maxTop)}px`
      }
      window.addEventListener('resize', keepInView)

      // The reported bug leaves the chrome rows without usable drag pixels, so arm the
      // band on load; the panel's buttons still remove and restore it.
      toggleBand(true)
      collect()
      render(body)
      return () => {
        window.clearInterval(timer)
        window.removeEventListener('resize', keepInView)
        observer.disconnect()
        panel.remove()
        toggleBand(false)
      }
    }

    /** Insert or remove the manual top drag band. */
    function toggleBand(on) {
      const existing = document.getElementById(BAND_ID)
      if (!on) {
        existing?.remove()
        state.injected = false
        return
      }
      if (existing !== null) { state.injected = true; return }
      const band = document.createElement('div')
      band.id = BAND_ID
      // Inline app-region wins over the shell's `body > :not(#root)` subtraction, and
      // appending last keeps the band after every no-drag box in document order.
      band.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'right:0', `height:${BAND_HEIGHT}px`,
        'z-index:2147483600', '-webkit-app-region:drag', `background:${BAND_FILL}`,
      ].join(';')
      document.body.append(band)
      state.injected = true
    }

    /** The plugin page's own detail row hosts this opener. */
    function ProbeButton() {
      const React = require('react')
      return React.createElement('button', {
        type: 'button',
        'data-window-drag-probe-open': '',
        onClick: () => {
          try { mountPanel() } catch (error) { console.error('[dsh-window-drag-probe]', error) }
        },
        style: {
          font: 'inherit',
          fontSize: '12px',
          padding: '4px 12px',
          borderRadius: '6px',
          border: '1px solid var(--dsw-alias-border-l3, #46506a)',
          background: 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12))',
          color: 'inherit',
          cursor: 'pointer',
        },
      }, '打开「窗口拖动诊断」面板')
    }

    /** Install the probe once per document. */
    function apply(ctx) {
      // A probe must never take the window down with it: the shell loads client
      // halves in one combo, so every failure is contained here.
      try {
        // In a plain browser the desktop preload is absent, so the darwin marker and
        // every darwin-only app-region rule are missing. `?dragprobe=darwin` mirrors
        // the marker so the same composition can be inspected outside the app.
        try {
          if (new URLSearchParams(location.search).get('dragprobe') === 'darwin') {
            document.documentElement.dataset.platform = 'darwin'
          }
        } catch { /* a non-standard location: leave the marker alone */ }

        // The deliverable is the band, not the panel: install the band on load and keep
        // the panel out of the way until the user asks for it from the plugin page.
        const start = () => {
          try { toggleBand(true) } catch (error) { console.error('[dsh-window-drag-probe]', error) }
        }
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
        else start()

        // The opener the plugin page's own row calls; also reachable by hand when the
        // panel has been hidden with its own button.
        globalThis.__dshWindowDragProbe = {
          open: () => { try { mountPanel() } catch (error) { console.error('[dsh-window-drag-probe]', error) } },
          close: () => { document.getElementById(PANEL_ID)?.remove() },
          band: {
            show: () => { toggleBand(true) },
            hide: () => { toggleBand(false) },
          },
        }
        // The plugin page's own detail row hosts the opener: opening the panel is the
        // only action this plugin exposes, so the button belongs on its own page.
        try {
          if (ctx && ctx.slots && typeof ctx.slots.inject === 'function') {
            ctx.slots.inject('plugins.detail.actions', () => ctx.slots.register({
              name: 'plugins.detail.actions',
              id: 'window-drag-probe',
              order: 50,
            }, ProbeButton))
          }
        } catch (error) {
          console.error('[dsh-window-drag-probe] slot', error)
        }

        if (ctx && typeof ctx.effect === 'function') {
          ctx.effect(() => () => {
            globalThis.__dshWindowDragProbe = undefined
            document.getElementById(PANEL_ID)?.remove()
            toggleBand(false)
          }, 'dsh-window-drag-probe: band')
        }
      } catch (error) {
        console.error('[dsh-window-drag-probe]', error)
      }
    }

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})
