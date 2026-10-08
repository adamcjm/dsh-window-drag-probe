/**
 * Regression tests for the client half of dsh-window-drag-probe.
 *
 * The probe runs inside a real Electron window, so these tests replace the DOM with a
 * deliberately small fake and assert the two things the field bug was about:
 *
 *   1. the band is installed by `apply()` alone — no button, no panel, no service, and
 *      even when the module executes before `document.body` exists;
 *   2. the band is the last body child, because the engine subtracts every no-drag box
 *      from the drag regions collected before it;
 *   3. the module never declares a hard dependency that can park the shell.
 *
 * Run with: node --test test/
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const SOURCE = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const BAND_ID = 'dsh-window-drag-probe-band'

/** Minimal element standing in for the DOM nodes the plugin touches. */
class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase()
    this.id = ''
    this.className = ''
    this.children = []
    this.parentNode = null
    this.textContent = ''
    this.attributes = new Map()
    this.listeners = new Map()
    this.style = {
      cssText: '',
      display: '',
      left: '',
      top: '',
      right: '',
      bottom: '',
      setProperty() {},
    }
  }

  append(...nodes) {
    for (const node of nodes) {
      if (node.parentNode !== null) node.parentNode.children = node.parentNode.children.filter((child) => child !== node)
      node.parentNode = this
      this.children.push(node)
    }
  }

  remove() {
    if (this.parentNode !== null) this.parentNode.children = this.parentNode.children.filter((child) => child !== this)
    this.parentNode = null
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type).push(listener)
  }

  removeEventListener() {}

  setAttribute(name, value) { this.attributes.set(name, String(value)) }

  hasAttribute(name) { return this.attributes.has(name) }

  getBoundingClientRect() { return { x: 0, y: 0, width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 } }

  querySelectorAll() { return [] }

  querySelector() { return null }

  setPointerCapture() {}

  releasePointerCapture() {}
}

/** Build one fake document plus the observers the plugin registers. */
function createDocument() {
  const doc = {
    readyState: 'complete',
    body: null,
    documentElement: new FakeElement('html'),
    listeners: new Map(),
    createElement: (tag) => new FakeElement(tag),
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, [])
      this.listeners.get(type).push(listener)
    },
    removeEventListener() {},
    getElementById(id) {
      const walk = (node) => {
        for (const child of node.children) {
          if (child.id === id) return child
          const found = walk(child)
          if (found !== null) return found
        }
        return null
      }
      const root = this.body ?? this.documentElement
      return walk(root)
    },
    querySelector: () => null,
    querySelectorAll: () => [],
  }
  doc.documentElement.dataset = {}
  doc.body = new FakeElement('body')
  doc.body.id = 'body'
  return doc
}

/** Load lib/client.js against a fake window/document and return its exports. */
function loadPlugin(document) {  const observers = []
  const timers = []
  let entry = null
  const window = {
    __ModuleLoader__: { load: (candidate) => { entry = candidate } },
    setInterval: (fn, ms) => { const id = timers.length + 1; timers.push({ fn, ms, id, cleared: false }); return id },
    clearInterval: (id) => { const timer = timers.find((candidate) => candidate.id === id); if (timer !== undefined) timer.cleared = true },
    setTimeout: () => 0,
    clearTimeout() {},
    addEventListener() {},
    removeEventListener() {},
    innerWidth: 1280,
    innerHeight: 820,
    screenX: 0,
    screenY: 0,
  }
  const context = {
    window,
    document,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this) }
      observe() {}
      disconnect() { this.disconnected = true }
      fire() { if (!this.disconnected) this.callback([]) }
    },
    performance: { now: () => 0 },
    location: { search: '' },
    URLSearchParams,
    console: { error() {}, warn() {}, log() {} },
  }
  const run = new Function(...Object.keys(context), SOURCE)
  run(...Object.values(context))
  assert.notEqual(entry, null, 'client.js must register itself through window.__ModuleLoader__.load')
  assert.equal(entry.id, 'dsh-window-drag-probe')
  const exports = entry.factory((name) => { throw new Error(`unexpected require: ${name}`) })
  return { exports, window, observers, timers }
}

/** A plugin context carrying only what the client half declares it uses. */
function makeContext(extra = {}) {
  return {
    // `ctx.effect` runs the setup immediately, exactly like the shell's plugin fiber.
    effect: (setup) => { setup(); return () => {} },
    ...extra,
  }
}

/** The service shape the plugin looks up optionally. */
function fakeSlots() {
  const registered = []
  return {
    registered,
    // The real service may run the callback synchronously, so both records can land in
    // either order; the assertions look them up by shape instead of by index.
    inject(key, callback) { registered.push({ key }); registered.push({ callback: callback() }) },
    register(options, component) { registered.push({ options, component }); return () => {} },
  }
}

test('loads a drag band without any panel, button or service', () => {
  const document = createDocument()
  const { exports } = loadPlugin(document)
  exports.apply(makeContext())

  const band = document.getElementById(BAND_ID)
  assert.notEqual(band, null, 'apply() alone must install the band')
  assert.match(band.style.cssText, /-webkit-app-region:drag/u)
  assert.match(band.style.cssText, /position:fixed/u)
  assert.match(band.style.cssText, /top:0/u)
  assert.match(band.style.cssText, /height:16px/u)
})

test('keeps the band as the last body child so no-drag boxes cannot subtract it', () => {
  const document = createDocument()
  const { exports } = loadPlugin(document)
  exports.apply(makeContext())

  const band = document.getElementById(BAND_ID)
  assert.equal(document.body.children.at(-1), band)
})

test('installs the band even when this module runs before document.body exists', () => {
  const document = createDocument()
  document.body = null
  const { exports, observers } = loadPlugin(document)
  exports.apply(makeContext())

  assert.equal(document.getElementById(BAND_ID), null, 'nothing can be inserted before the body exists')

  document.body = new FakeElement('body')
  assert.ok(observers.length > 0, 'a body observer must be armed for the deferred install')
  for (const observer of observers) observer.fire()

  assert.notEqual(document.getElementById(BAND_ID), null, 'the band must arrive with the body')
})

test('re-applying the plugin keeps exactly one band', () => {
  const document = createDocument()
  const { exports } = loadPlugin(document)
  exports.apply(makeContext())
  exports.apply(makeContext())

  const bands = document.body.children.filter((child) => child.id === BAND_ID)
  assert.equal(bands.length, 1)
})

test('declares no hard dependency, so the shell can never park waiting for a service', () => {
  const document = createDocument()
  const { exports } = loadPlugin(document)
  assert.deepEqual(exports.inject, [])
})

test('registers the plugin-page opener when slots is already available', () => {
  const document = createDocument()
  const { exports } = loadPlugin(document)
  const slots = fakeSlots()
  exports.apply(makeContext({ get: (key) => (key === 'slots' ? slots : undefined) }))

  assert.ok(slots.registered.some((entry) => entry.key === 'plugins.detail.actions'))
  assert.ok(slots.registered.some((entry) => entry.options?.id === 'window-drag-probe'))
})

test('survives a shell without slots', () => {
  const document = createDocument()
  const { exports } = loadPlugin(document)
  exports.apply(makeContext({ get: () => undefined }))

  assert.notEqual(document.getElementById(BAND_ID), null)
})

test('exposes a manual handle for the band and the panel', () => {
  const document = createDocument()
  const { exports } = loadPlugin(document)
  exports.apply(makeContext())

  const handle = globalThis.__dshWindowDragProbe
  assert.equal(typeof handle.open, 'function')
  assert.equal(typeof handle.close, 'function')
  assert.equal(typeof handle.band.show, 'function')
  assert.equal(typeof handle.band.hide, 'function')

  handle.band.hide()
  assert.equal(document.getElementById(BAND_ID), null)
  handle.band.show()
  assert.notEqual(document.getElementById(BAND_ID), null)
})

test('the watchdog restores a band removed by another party', () => {
  const document = createDocument()
  const { exports, timers } = loadPlugin(document)
  exports.apply(makeContext())
  const handle = globalThis.__dshWindowDragProbe

  handle.band.hide()
  assert.equal(document.getElementById(BAND_ID), null)
  for (const timer of timers) if (!timer.cleared) timer.fn()

  assert.notEqual(document.getElementById(BAND_ID), null)
})

test('the band stays reachable when a later body child would cover the drag strip', () => {
  const document = createDocument()
  const { exports, timers } = loadPlugin(document)
  exports.apply(makeContext())

  const overlay = new FakeElement('div')
  overlay.id = 'late-overlay'
  document.body.append(overlay)
  assert.equal(document.body.children.at(-1), overlay)

  for (const timer of timers) if (!timer.cleared) timer.fn()
  assert.equal(document.body.children.at(-1).id, BAND_ID)
})

test('the plugin is listed under its new name', () => {
  const zh = JSON.parse(readFileSync(new URL('../locale/zh.json', import.meta.url), 'utf8'))
  const en = JSON.parse(readFileSync(new URL('../locale/en.json', import.meta.url), 'utf8'))
  assert.equal(zh.meta.title, '窗口拖动')
  assert.equal(en.meta.title, 'Window Drag')
})
