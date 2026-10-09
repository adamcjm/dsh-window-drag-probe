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
    /** Points the probe reports on, in viewport CSS pixels, keyed to the dictionaries. */
    const SAMPLES = [
      { key: 'sampleTopStrip', x: 150, y: 44 },
      { key: 'sampleLogoRow', x: 106, y: 71 },
      { key: 'sampleWindowTop', x: 640, y: 4 },
    ]
    /** Row heights of the draggability matrix, from the window's top edge down. */
    const SCAN_Y = [4, 20, 36, 52, 68, 84]
    /** Columns of the draggability matrix, across the whole window width. */
    const SCAN_X = [40, 140, 240, 400, 640, 900]

    /** Dictionary namespace owned by this plugin in the shell's locale service. */
    const NS = 'window-drag-probe'

    /**
     * Every user-facing string this half owns, in both shipped languages. The keys of the
     * two dictionaries must stay identical; `test/client.test.mjs` fails the build when
     * they drift, and the shell requires a complete set per registration anyway.
     */
    const DICTIONARIES = {
      zh: {
        panelTitle: 'DSH 窗口拖动 · 顶部蓝条可拖窗',
        collapseToggle: '折叠 / 展开',
        refresh: '重新采集',
        bandAdd: '插入顶部拖拽带',
        bandRemove: '移除拖拽带',
        resetPosition: '复位位置',
        hidePanel: '隐藏面板',
        opener: '打开「窗口拖动」面板',
        platformValue: 'platform: {value}',
        computedBody: 'computed app-region · body: {value}',
        computedRow: 'computed app-region · 首个 [data-window-drag] 行: {value}',
        verdictLabel: '判定: {value}',
        verdictOk: '该行解析为 drag ✓',
        verdictBad: '该行不是 drag ✗（属性未被支持，或被更高优先级的 no-drag 规则盖住）',
        recallLabel: 'recall 标记当前: {value}',
        recallSet: '已设置（整窗拖拽被减掉）',
        recallCleared: '未设置',
        recallPulses: 'recall 脉冲次数（本次加载以来）: {value}',
        windowPosition: '窗口位置: {x}, {y}   ← 拖动窗口时这里会变',
        movesLabel: '窗口移动记录: {value}',
        movesNone: '无（尚未检测到窗口被拖动）',
        dragRows: 'drag 行 ({n}):',
        regionBoxes: 'app-region 盒子: {n} 个（drag {drag} / no-drag {noDrag}）',
        matrixTitle: '顶部可拖性矩阵（■=可拖 ·=不可拖；列=x，行=y）:',
        sampleTitle: '采样点命中链（DOM 顺序，最后一条决定该点）:',
        draggable: '可拖',
        notDraggable: '不可拖',
        sampleHit: '{label} ({x},{y}) → {verdict}',
        noBoxAtPoint: '      (没有任何 app-region 盒子包含该点)',
        bodyExtras: 'body 直属子元素（除 #root）: {value}',
        none: '无',
        bandState: '手动拖拽带: {value}',
        bandInserted: '已插入（窗口顶部 {h}px）',
        bandAbsent: '未插入',
        sampleTopStrip: '侧边栏 topStrip 空白',
        sampleLogoRow: '侧边栏 logoRow',
        sampleWindowTop: '窗口最顶端',
      },
      en: {
        panelTitle: 'DSH window drag · the blue top strip moves the window',
        collapseToggle: 'Collapse / expand',
        refresh: 'Re-scan',
        bandAdd: 'Add top drag band',
        bandRemove: 'Remove drag band',
        resetPosition: 'Reset position',
        hidePanel: 'Hide panel',
        opener: 'Open the “Window Drag” panel',
        platformValue: 'platform: {value}',
        computedBody: 'computed app-region · body: {value}',
        computedRow: 'computed app-region · first [data-window-drag] row: {value}',
        verdictLabel: 'verdict: {value}',
        verdictOk: 'the row resolves to drag ✓',
        verdictBad: 'the row is not drag ✗ (property unsupported, or a higher-priority no-drag rule wins)',
        recallLabel: 'recall mark now: {value}',
        recallSet: 'set (the whole window is subtracted)',
        recallCleared: 'not set',
        recallPulses: 'recall pulses (since this load): {value}',
        windowPosition: 'window position: {x}, {y}   ← this changes when the window moves',
        movesLabel: 'window moves: {value}',
        movesNone: 'none (no window drag observed yet)',
        dragRows: 'drag rows ({n}):',
        regionBoxes: 'app-region boxes: {n} (drag {drag} / no-drag {noDrag})',
        matrixTitle: 'top draggability matrix (■=draggable ·=not; columns=x, rows=y):',
        sampleTitle: 'sample point hit chains (DOM order, the last hit decides):',
        draggable: 'draggable',
        notDraggable: 'not draggable',
        sampleHit: '{label} ({x},{y}) → {verdict}',
        noBoxAtPoint: '      (no app-region box contains this point)',
        bodyExtras: 'direct body children (besides #root): {value}',
        none: 'none',
        bandState: 'manual drag band: {value}',
        bandInserted: 'installed ({h}px at the window top)',
        bandAbsent: 'not installed',
        sampleTopStrip: 'sidebar topStrip blank area',
        sampleLogoRow: 'sidebar logoRow',
        sampleWindowTop: 'very top of the window',
      },
    }

    /** Substitute `{name}` placeholders in one dictionary entry. */
    function fill(template, params) {
      return String(template).replace(/\{(\w+)\}/g, (match, key) => (
        params[key] === undefined ? match : String(params[key])
      ))
    }

    /** Translate one key; replaced by the shell's translator when locale is available. */
    let t = (key) => DICTIONARIES.zh[key] ?? key

    /** Refreshes the open panel in the active language; null while no panel is mounted. */
    let refreshPanel = null

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
    /** Brighter fill while the pointer is over the band, so the drag strip is findable. */
    const BAND_FILL_HOVER = 'rgba(138,180,255,0.34)'

    /** Render the current state into the panel body. */
    function render(body) {
      const dragCount = state.regions.filter((region) => region.region === 'drag').length
      const lines = []
      lines.push(fill(t('platformValue'), { value: state.platform }))
      lines.push(fill(t('computedBody'), { value: state.bodyRegionValue }))
      lines.push(fill(t('computedRow'), { value: state.rowRegionValue }))
      lines.push(fill(t('verdictLabel'), { value: state.propertyHonoured ? t('verdictOk') : t('verdictBad') }))
      lines.push(fill(t('recallLabel'), { value: state.recallSet ? t('recallSet') : t('recallCleared') }))
      lines.push(fill(t('recallPulses'), { value: state.recallPulses }))
      lines.push(fill(t('windowPosition'), { x: state.windowX, y: state.windowY }))
      lines.push(fill(t('movesLabel'), {
        value: state.moves.length === 0 ? t('movesNone') : state.moves.slice(-6).join(' | '),
      }))
      lines.push('')
      lines.push(fill(t('dragRows'), { n: state.rows.length }))
      for (const row of state.rows) {
        lines.push(`  ${row.cls}  ${row.w}x${row.h} @${row.x},${row.y}  app-region=${row.region}`)
      }
      lines.push('')
      lines.push(fill(t('regionBoxes'), {
        n: state.regions.length,
        drag: dragCount,
        noDrag: state.regions.length - dragCount,
      }))
      for (const region of state.regions.slice(0, 12)) {
        lines.push(`  ${region.region.padEnd(7)} ${region.tag} ${region.w}x${region.h} @${region.x},${region.y} ${region.cls}`)
      }
      lines.push('')
      lines.push(t('matrixTitle'))
      lines.push('        ' + SCAN_X.map((x) => String(x).padStart(6)).join(''))
      for (const y of SCAN_Y) {
        const cells = SCAN_X.map((x) => (draggableAt(state.regions, x, y) ? '     ■' : '     ·')).join('')
        lines.push(`  y=${String(y).padStart(2)}${cells}`)
      }
      lines.push('')
      lines.push(t('sampleTitle'))
      for (const sample of SAMPLES) {
        const hits = state.regions.filter((region) => sample.x >= region.x && sample.x < region.x + region.w
          && sample.y >= region.y && sample.y < region.y + region.h)
        lines.push('  ' + fill(t('sampleHit'), {
          label: t(sample.key),
          x: sample.x,
          y: sample.y,
          verdict: draggableAt(state.regions, sample.x, sample.y) ? t('draggable') : t('notDraggable'),
        }))
        if (hits.length === 0) lines.push(t('noBoxAtPoint'))
        // The tail of the chain is what wins: name it, so the eraser is identifiable.
        for (const hit of hits.slice(-4)) {
          lines.push(`      ${hit.region.padEnd(7)} ${hit.tag} ${hit.w}x${hit.h} @${hit.x},${hit.y} ${hit.cls}`)
        }
      }
      lines.push('')
      lines.push(fill(t('bodyExtras'), {
        value: state.bodyExtras.length === 0 ? t('none') : state.bodyExtras.join(' ; '),
      }))
      lines.push(fill(t('bandState'), {
        value: state.injected ? fill(t('bandInserted'), { h: BAND_HEIGHT }) : t('bandAbsent'),
      }))
      body.textContent = lines.join('\n')
    }

    /** Build the panel, its refresh loop and its buttons. */
    function mountPanel() {
      // Idempotent by design: the panel element id is the guard. An earlier revision only
      // declared that guard in a comment and never implemented it, so every press stacked
      // another panel in the same corner and each copy could only be closed by its own
      // button. Reuse the open panel instead, and collapse any duplicates on the way.
      const adopted = adoptPanel()
      if (adopted !== null) {
        hintPanel(adopted)
        return
      }
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
      label.textContent = t('panelTitle')
      label.style.cssText = 'font-weight:600;color:#8ab4ff;flex:1;pointer-events:none'
      const collapse = document.createElement('button')
      collapse.type = 'button'
      collapse.title = t('collapseToggle')
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

      const refreshButton = button(t('refresh'), () => { collect(); render(body) })
      const bandOnButton = button(t('bandAdd'), () => { toggleBand(true); collect(); render(body) })
      const bandOffButton = button(t('bandRemove'), () => { toggleBand(false); collect(); render(body) })
      const resetButton = button(t('resetPosition'), () => {
        panel.style.left = ''
        panel.style.top = ''
        panel.style.right = '10px'
        panel.style.bottom = '10px'
        try { localStorage.removeItem(POS_KEY) } catch { /* private mode */ }
      })
      const hideButton = button(t('hidePanel'), () => { panel.remove() })
      bar.append(refreshButton, bandOnButton, bandOffButton, resetButton, hideButton)
      panel.append(bar)
      document.body.append(panel)

      // Captions read `t` at label time, so a locale switch can relabel a panel that is
      // already on screen: the shell notifies the apply hook, which runs this refresh.
      const captions = [
        [label, 'panelTitle'],
        [refreshButton, 'refresh'],
        [bandOnButton, 'bandAdd'],
        [bandOffButton, 'bandRemove'],
        [resetButton, 'resetPosition'],
        [hideButton, 'hidePanel'],
      ]
      const applyCaptions = () => {
        for (const [element, key] of captions) element.textContent = t(key)
        collapse.title = t('collapseToggle')
      }
      refreshPanel = () => { applyCaptions(); collect(); render(body) }

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
        refreshPanel = null
        toggleBand(false)
      }
    }

    /** Hover cue: the band must be findable without a pointer-event probe. */
    const BAND_STYLE_ID = 'dsh-window-drag-probe-band-style'

    /** Insert or remove the manual top drag band. */
    function toggleBand(on) {
      const existing = document.getElementById(BAND_ID)
      if (!on) {
        existing?.remove()
        document.getElementById(BAND_STYLE_ID)?.remove()
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
      // The band answers a window drag by design, so its own affordance has to come
      // from CSS: a pointer press there never reaches the page as a pointer event.
      const style = document.createElement('style')
      style.id = BAND_STYLE_ID
      style.textContent = [
        `#${BAND_ID}{transition:background .12s ease}`,
        `#${BAND_ID}:hover{background:${BAND_FILL_HOVER}}`,
      ].join('')
      document.body.append(style, band)
      state.injected = true
    }

    /**
     * The plugins page renders `plugins.detail.actions` for three different subjects — a
     * bundle, one configuration row, or a built-in item — and its contract says a
     * contribution renders null for a subject it has no control for. Without that check
     * this button showed up on every plugin's page; with it, only on our own.
     */
    const OWN_PACKAGE = 'dsh-window-drag-probe'
    const OWN_ROW = 'window-drag-probe'

    /** Whether one identity string names this plugin (row id, package name, `scope:id`). */
    function namesThisPlugin(value) {
      if (typeof value !== 'string') return false
      return value === OWN_ROW || value === OWN_PACKAGE
        || value.endsWith(`:${OWN_ROW}`) || value.endsWith(`/${OWN_ROW}`)
    }

    /** Whether a detail subject belongs to this plugin. */
    function subjectIsOurs(subject) {
      if (subject === null || typeof subject !== 'object') return false
      const pkg = subject.pkg
      if (pkg !== null && typeof pkg === 'object') {
        if (namesThisPlugin(pkg.name)) return true
        if (Array.isArray(pkg.rows) && pkg.rows.some((row) => row !== null && typeof row === 'object'
          && (namesThisPlugin(row.rowId) || namesThisPlugin(row.moduleName)))) return true
      }
      const row = subject.row
      if (row !== null && typeof row === 'object'
        && (namesThisPlugin(row.rowId) || namesThisPlugin(row.moduleName))) return true
      return namesThisPlugin(subject.id) || namesThisPlugin(subject.rowId) || namesThisPlugin(subject.name)
    }

    /** The panel already in the document, with every later duplicate collapsed away. */
    function adoptPanel() {
      const first = document.getElementById(PANEL_ID)
      if (first === null) return null
      if (typeof document.querySelectorAll === 'function') {
        for (const node of Array.from(document.querySelectorAll(`#${PANEL_ID}`))) {
          if (node !== first) node.remove()
        }
      }
      return first
    }

    /** Remove every panel, including duplicates left behind by an older revision. */
    function removePanels() {
      let node = document.getElementById(PANEL_ID)
      while (node !== null) {
        node.remove()
        node = document.getElementById(PANEL_ID)
      }
    }

    /** Flash the outline, so a reused panel reads as "already open" rather than "nothing happened". */
    function hintPanel(panel) {
      try {
        panel.style.outline = '2px solid rgba(138,180,255,.75)'
        window.setTimeout(() => { panel.style.outline = '' }, 240)
      } catch { /* a hint must never take the panel down */ }
    }

    /** The plugin page's own detail row hosts this opener. */
    function ProbeButton(props) {
      const subject = props === undefined ? undefined : props.subject
      if (!subjectIsOurs(subject)) return null
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
      }, t('opener'))
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

        // The panel is the only part of this plugin that carries its own copy, so the
        // dictionaries ride the optional `locale` service: the shell picks the language,
        // and a switch relabels an open panel through its change notification.
        // Registration is per language (the untyped form), so it never demands the full
        // built-in language set, and a shell without locale keeps the Chinese fallback.
        try {
          const locale = ctx && typeof ctx.get === 'function' ? ctx.get('locale') : undefined
          if (locale !== undefined && locale !== null && typeof locale.bind === 'function') {
            t = locale.bind(NS)
            for (const [language, dictionary] of Object.entries(DICTIONARIES)) {
              try {
                const dispose = typeof locale.register === 'function'
                  ? locale.register(NS, language, dictionary)
                  : undefined
                if (typeof dispose === 'function' && typeof ctx.effect === 'function') {
                  ctx.effect(() => dispose, `dsh-window-drag-probe: locale ${language}`)
                }
              } catch (error) { console.error('[dsh-window-drag-probe] locale', error) }
            }
            if (typeof locale.subscribe === 'function') {
              const unsubscribe = locale.subscribe(() => { if (refreshPanel !== null) refreshPanel() })
              if (typeof ctx.effect === 'function') {
                ctx.effect(() => unsubscribe, 'dsh-window-drag-probe: locale refresh')
              }
            }
          }
        } catch (error) { console.error('[dsh-window-drag-probe] locale', error) }

        // The band is the deliverable and must exist from the first possible moment of
        // every document, including a cold start where this module runs before the body
        // is parsed: install now, re-arm on the body's arrival, and keep a watchdog
        // re-arming it while the plugin is live. A previous revision removed the band
        // from the effect cleanup, which a re-applied row then ran against the freshly
        // installed band — the band vanished without a trace.
        const arm = () => {
          if (document.body === null) return
          try { toggleBand(true) } catch (error) { console.error('[dsh-window-drag-probe] band', error) }
        }
        arm()
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arm, { once: true })
        if (document.body === null && typeof MutationObserver === 'function') {
          // `document.body` is absent exactly when the shell injects this module from the
          // head: wait for the element instead of relying on the 1s watchdog alone.
          const bodyWatch = new MutationObserver(() => {
            if (document.body === null) return
            bodyWatch.disconnect()
            arm()
          })
          bodyWatch.observe(document.documentElement, { childList: true })
        }

        // The opener the plugin page's own row calls; also reachable by hand when the
        // panel has been hidden with its own button.
        globalThis.__dshWindowDragProbe = {
          open: () => { try { mountPanel() } catch (error) { console.error('[dsh-window-drag-probe]', error) } },
          close: () => { removePanels() },
          band: { show: arm, hide: () => { toggleBand(false) } },
        }

        // The plugin page's own detail row hosts the opener. Two rules decide the shape
        // here. First, this row is deliberately not a bootstrap-batch entry: a bundle
        // fault in that batch parks the whole shell on "Loading plugins…", so the row
        // ships in the ordinary application batch where it can only cost itself. Second,
        // the button is optional polish, so it registers through the optional service
        // lookup and retries briefly instead of costing the band or the page.
        const registerOpener = () => {
          const slots = ctx && typeof ctx.get === 'function' ? ctx.get('slots') : undefined
          if (slots === undefined || slots === null || typeof slots.inject !== 'function') return false
          try {
            slots.inject('plugins.detail.actions', () => slots.register({
              name: 'plugins.detail.actions',
              id: 'window-drag-probe',
              order: 50,
            }, ProbeButton))
          } catch (error) {
            console.error('[dsh-window-drag-probe] slot', error)
          }
          return true
        }
        if (!registerOpener()) {
          let tries = 0
          const slotTimer = window.setInterval(() => {
            tries += 1
            if (registerOpener() || tries >= 20) window.clearInterval(slotTimer)
          }, 500)
        }

        if (ctx && typeof ctx.effect === 'function') {
          ctx.effect(() => {
            const watchdog = window.setInterval(() => {
              if (document.getElementById(BAND_ID) === null) { arm(); return }
              // Document order is the whole trick: the engine subtracts every no-drag box
              // from the drag regions collected before it, and the shell's
              // `body > :not(#root)` rule marks every later body child no-drag. Keeping the
              // band last keeps the strip draggable against anything the shell appends.
              const band = document.getElementById(BAND_ID)
              if (band !== null && document.body !== null && document.body.lastElementChild !== band) {
                document.body.append(band)
              }
            }, 1000)
            return () => {
              // Stopping the watchdog first is what keeps the band removed afterwards.
              window.clearInterval(watchdog)
              removePanels()
              toggleBand(false)
            }
          }, 'dsh-window-drag-probe: band watchdog')
        }
      } catch (error) {
        console.error('[dsh-window-drag-probe]', error)
      }
    }

    exports.apply = apply
    // No hard dependency and no bootstrap-batch slot: a malformed or waiting entry in the
    // bootstrap batch leaves the window on "Loading plugins…" forever, so this row takes
    // the ordinary batch and asks for `slots` through the optional lookup instead.
    exports.inject = []
    return module.exports
  },
})
