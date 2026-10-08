/**
 * Host half of dsh-window-drag-probe.
 *
 * The probe is browser-only: everything it does happens inside the window whose
 * drag regions are in question, so the client half (lib/client.js) owns all the
 * work. This entry exists so the loader can mount the row.
 */
export const name = 'dsh-window-drag-probe'

/** No host-side behavior; the drag surface lives in the renderer. */
export function apply() {}
