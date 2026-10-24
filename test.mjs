import assert from 'node:assert/strict'
import z from '@deepseek-ai/schemastery'
import { Config, apply } from './index.js'
import { normalizeTags, renderPrivateSection, renderTagsSection, routeKey } from './guidance.js'

// The Loader validates a plugin Config through the Standard Schema interface;
// the settings service projects the same schema into forms.
const parsed = Config['~standard'].validate({
  tags: [{ provider: 'vllm-local', model: 'qwen3-32b', labels: ['低成本', '代码特化'] }],
})
assert.equal(parsed.issues, undefined)
assert.equal(typeof parsed.value.tags.get, 'function', 'tags must stay volatile for live settings writes')
assert.deepEqual(parsed.value.tags.get(), [
  { provider: 'vllm-local', model: 'qwen3-32b', labels: ['低成本', '代码特化'] },
])

// The settings service rebuilds the form schema with its own schemastery copy
// from `toJSON()`; the tags field must survive that round trip as volatile.
const rebuilt = new z(Config.toJSON())
const rebuiltValue = rebuilt({
  tags: [{ provider: 'vllm-local', model: 'qwen3-32b', labels: ['低成本'] }],
})
assert.equal(typeof rebuiltValue.tags.get, 'function', 'toJSON round trip keeps tags volatile')
assert.deepEqual(rebuiltValue.tags.get(), [{ provider: 'vllm-local', model: 'qwen3-32b', labels: ['低成本'] }])

const empty = Config['~standard'].validate({})
assert.deepEqual(empty.value.tags.get(), [])
assert.ok(Config['~standard'].validate({ tags: [{ provider: 'x' }] }).issues?.length > 0, 'a tag needs a model')

// --- tag normalization -------------------------------------------------------
assert.deepEqual(normalizeTags(undefined), [])
assert.deepEqual(
  normalizeTags([
    { provider: 'p', model: 'm', labels: ['低成本', '低成本', ' 快速 ', ''] },
    { provider: 'p', model: 'm', labels: ['重复路由'] },
    { provider: 'p', model: 'n', labels: [] },
    { provider: 'p', model: 'o', labels: ['代码特化'] },
  ]).map((tag) => [tag.model, tag.labels]),
  [['m', ['低成本', '快速']], ['o', ['代码特化']]],
  'duplicates collapse, empty labels drop, and a label-less route carries no semantics',
)

// --- section rendering -------------------------------------------------------
const allowed = new Set([routeKey('vllm-local', 'qwen3-32b')])
const tagged = renderTagsSection({
  tags: [
    { provider: 'vllm-local', model: 'qwen3-32b', labels: ['低成本', '代码特化'] },
    { provider: 'other', model: 'm', labels: ['多模态'] },
  ],
  allowed,
})
assert.match(tagged, /`vllm-local\/qwen3-32b` — 低成本, 代码特化 \(delegable\)/)
assert.match(tagged, /`other\/m` — 多模态\n/, 'a non-delegable route keeps its tags without a delegable mark')
assert.match(tagged, /Routes marked "delegable"/)
assert.match(tagged, /list_subagent_models/)

const privateSection = renderPrivateSection({ allowed: new Set([routeKey('p', 'm')]) })
assert.match(privateSection, /`p\/m`/)
assert.match(privateSection, /not billed per token/)
assert.equal(renderPrivateSection({ allowed: new Set() }), '')

// --- Host glue ---------------------------------------------------------------
const sections = []
function makeCtx({ providerParameter = true, allowedModels = [] } = {}) {
  return {
    systemPrompt: {
      getSectionOrder: () => 250,
      section: (section) => sections.push(section),
    },
    tools: {
      get: () => providerParameter
        ? { parameters: { cwd: {}, description: {}, prompt: {}, provider: {}, model: {} } }
        : { parameters: { cwd: {}, description: {}, prompt: {} } },
    },
    get: (name) => name === 'subagentModelSelection'
      ? { current: () => ({ enabled: true, allowedModels }) }
      : undefined,
  }
}

apply(makeCtx({ allowedModels: [{ provider: 'vllm-local', model: 'qwen3-32b' }] }), {
  tags: {
    get: () => [
      { provider: 'vllm-local', model: 'qwen3-32b', labels: ['低成本'] },
      { provider: 'other', model: 'm', labels: ['多模态'] },
    ],
  },
})
assert.equal(sections.length, 1)
assert.equal(sections[0].name, 'private-model-routing')
assert.equal(sections[0].order, 251)
const live = sections[0].text({ scope: {} })
assert.match(live, /`vllm-local\/qwen3-32b` — 低成本 \(delegable\)/)
assert.match(live, /`other\/m` — 多模态/)

apply(makeCtx({ allowedModels: [{ provider: 'p', model: 'm' }] }), { tags: { get: () => [] } })
assert.match(sections.at(-1).text({ scope: {} }), /Private model routes/)

apply(makeCtx({ providerParameter: false, allowedModels: [{ provider: 'p', model: 'm' }] }), { tags: { get: () => [] } })
assert.equal(sections.at(-1).text({ scope: {} }), '', 'no tag and no child-model selection renders nothing')

console.log('private-model-routing: Config, guidance, and Host glue tests passed')
