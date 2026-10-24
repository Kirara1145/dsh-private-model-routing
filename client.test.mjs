import assert from 'node:assert/strict'

// The browser half is a plain module-loader entry: stub the loader, then drive
// its apply() against mocked client services so the slot wiring is verified
// without a browser.
const loaded = []
globalThis.window = { __ModuleLoader__: { load: (definition) => loaded.push(definition) } }
await import('./client.js')

assert.equal(loaded.length, 1)
assert.equal(loaded[0].id, '@local/dsh-private-model-routing')

let catalogCalls = 0
const form = {
  getSnapshot: () => ({ status: 'ready', writable: true, revision: 7, value: { tags: [] } }),
  subscribe: () => () => {},
  mutate: async () => {},
}
const registrations = []
const slots = {
  inject: (slot, callback) => callback(),
  register: (options, component) => {
    registrations.push({ options, component })
    return () => {}
  },
}
const ctx = {
  effect: (fn) => fn(),
  locale: { register: () => () => {}, bind: () => (key) => key },
  configForms: {
    whileServed: (namespaces, register) => register(namespaces),
    get: (ns) => {
      assert.equal(ns, 'private-model-routing')
      return form
    },
  },
  slots,
  remote: {
    $on: () => () => {},
    session: {
      modelCatalog: async () => {
        catalogCalls += 1
        return { ok: true, value: { groups: [{ id: 'llm-pi-ai-provider', models: [{ id: 'qwen3-32b', name: 'Qwen3 32B' }] }], failures: [] } }
      },
    },
  },
}

const React = {
  createElement: () => null,
  useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
  useCallback: (fn) => fn,
  useEffect: () => {},
  useId: () => 'list-id',
}
const module = loaded[0].factory((name) => (name === 'react' ? React : undefined))
assert.deepEqual(module.inject, ['slots', 'locale', 'configForms', 'remote', 'remote.session'])

module.apply(ctx)

assert.deepEqual(
  registrations.map((entry) => entry.options.key),
  ['llm-pi-ai', 'llm-deepseek'],
  'the editor registers into both adapter families',
)
for (const entry of registrations) {
  assert.equal(entry.options.name, 'settings.models.provider-card')
  assert.equal(entry.options.locale, 'privateModelRouting')
  const injected = entry.options.inject()
  assert.equal(injected.form, form)
  assert.equal(typeof injected.loadCatalog, 'function')
}

const injected = registrations[0].options.inject()
const groups = await injected.loadCatalog()
assert.equal(groups.length, 1)
await injected.loadCatalog()
assert.equal(catalogCalls, 1, 'the model directory is fetched once and cached')

console.log('private-model-routing: client slot wiring tests passed')
