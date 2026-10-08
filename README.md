# dsh-window-drag-probe

English | [中文](README.zh.md)

A [DSH](https://github.com/deepseek-ai/deepseek-harness) plugin that restores window dragging on macOS DSH Desktop and diagnoses why it broke — from inside the running window.

Upstream report: **[deepseek-ai/deepseek-harness discussion #9112](https://github.com/deepseek-ai/deepseek-harness/discussions/9112)**

---

## Why this exists

On macOS, DSH Desktop is a `hiddenInset` window with **no native title bar**, so dragging depends entirely on `-webkit-app-region: drag` boxes declared by the page. The shell marks its chrome rows with `data-window-drag`, and `ui-web`'s `base.css` turns that mark into the one drag rule.

In practice those rows are **not draggable**: the interactive `no-drag` selector in the same sheet matches thousands of boxes in the real DOM (buttons, `[tabindex]` focus containers, ARIA-role widgets), and any one of them that overlaps a chrome row *later in document order* subtracts that overlap. What is left of the chrome band is a sliver a few pixels tall, so pressing anywhere that looks like a title bar does nothing.

The plugin does **not** patch any official file. It adds:

1. **A 16 px drag band** across the top of the window, appended to `document.body` **last** with an inline `app-region: drag` — document order is what wins in Electron's composition, so the band cannot be subtracted by earlier `no-drag` boxes.
2. **A diagnostic panel** that reports the evidence from the live window: the platform marker, the computed `app-region` of the chrome rows, the recall mark, every app-region box, a draggability matrix, and window movement read from `window.screenX/screenY`.

---

## Install

### A. From the plugin page (recommended on DSH Desktop)

DSH Desktop manages its own profile exclusively, so the CLI refuses it — install through the UI:

1. Sidebar → **Plugins** → **Add plugin** → open the arrow menu → **Install a third-party plugin**
2. Paste the repository address:

   ```
   https://github.com/adamcjm/dsh-window-drag-probe
   ```

3. Install, then choose **Enable now**
4. **Quit DSH Desktop completely (⌘Q) and reopen it** — the client bundle is assembled once at host boot, so a window close is not enough

### B. CLI (profiles managed from the command line)

```sh
dsh plugin --profile <profile> add https://github.com/adamcjm/dsh-window-drag-probe
```

Then restart that host.

### C. Local checkout (development)

```sh
git clone https://github.com/adamcjm/dsh-window-drag-probe
dsh plugin --profile <profile> add "$PWD/dsh-window-drag-probe"
```

A local directory install is linked, not copied, so edits take effect on the next host restart.

---

## Usage

### Drag band

After the host restarts, a faint blue band spans the **top 16 px** of the window. Press anywhere inside it and drag: the window moves.

- The band is deliberately visible — a draggable region swallows pointer events, so no hover cue is possible, and an invisible band is unusable.
- Everything below the band behaves normally; the band does not intercept clicks outside its 16 px.
- Only one band exists per window; re-arming is idempotent.

### Diagnostic panel

Plugins → open **Window Drag** → press **打开「窗口拖动」面板** (the button this plugin registers on its own page).

The panel is draggable by its header, collapsible with `▾`, remembers its position, and reports:

| Row | Meaning |
| --- | --- |
| `platform` | The `data-platform` marker. `darwin` is the only value where any drag rule exists. |
| `computed app-region · body / first row` | The raw computed values. `drag` on the row means the cascade is fine and the loss happens in composition. |
| `recall 标记当前` | Whether the shell's `data-window-drag-recall` pulse is stuck on. A stuck mark subtracts the whole surface. |
| `窗口位置` / `窗口移动记录` | Live `window.screenX/screenY` — the only in-page witness of a native window move. |
| `drag 行` | Every `[data-window-drag]` element with its box and computed value. |
| `app-region 盒子` | Every box whose computed `app-region` is not `none`, in document order. |
| `顶部可拖性矩阵` | A `■`/`·` matrix over the top band, decided by the project's own model (last containing box in document order wins). |
| `采样点命中链` | For each sample point, the boxes containing it and which one decides. |

Panel buttons: **重新采集** (re-collect), **插入/移除顶部拖拽带**, **复位位置**, **隐藏面板**.

---

## Uninstall

- **Plugin page**: open the plugin card → **卸载** (Uninstall).
- **CLI**: `dsh plugin --profile <profile> remove dsh-window-drag-probe`
- **Manual installs**: remove the `dsh-window-drag-probe` symlink from the profile's `node_modules`, then restore `package.json` / `cordis.patch.yml` from your backups.

Uninstalling removes the band; after a restart the window is back to its previous (undraggable) state.

---

## Verified on

| | |
| --- | --- |
| DSH Desktop | 0.2.0-rc.2 |
| Electron | 44.0.0 |
| macOS | 27.0.1 (26A434, Apple Silicon) |

The band is armed unconditionally, but the app-region rules it compensates for only exist under `html[data-platform='darwin']`. On other platforms the plugin still loads and the panel still reports, with `platform` showing the actual marker.

## Limits

- This is a **workaround plus a probe**, not an upstream fix. If the matrix shows `drag` at a point yet the window still does not move there, the cause is outside the page and only the upstream fix (see the discussion) will help.
- The plugin appends one `div` to `document.body` and registers one button in the plugin page. It reads DOM state and `screenX/screenY`; it sends nothing anywhere.
- The panel is intentionally a plain DOM overlay rather than a slot decoration: it must be positionable over the whole viewport, and the drag band must be last in document order.

## License

MIT
