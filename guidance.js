/**
 * Pure prompt rendering for @local/dsh-private-model-routing.
 *
 * The tags are the user's own description of a model route, edited per provider
 * in Settings → Models. The Host adds them to the system prompt so the agent can
 * route work by them; the route allowlist stays owned by the Host
 * `subagentModelSelection` setting.
 */

const MAX_ROUTES = 40
const MAX_LABELS = 8
const MAX_LABEL_LENGTH = 40

function nonEmpty(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function routeKey(provider, model) {
  return `${provider}\u0000${model}`
}

function cleanLabels(raw) {
  const labels = []
  if (!Array.isArray(raw)) return labels
  for (const value of raw) {
    const label = nonEmpty(value).slice(0, MAX_LABEL_LENGTH)
    if (label.length === 0 || labels.includes(label)) continue
    labels.push(label)
    if (labels.length >= MAX_LABELS) break
  }
  return labels
}

/**
 * Normalize the config value into the routes this plugin will describe.
 * Malformed entries are dropped; a route with no labels carries no semantics
 * and is left to the untagged-route fallback.
 *
 * @param {unknown} raw - the `tags` config value.
 * @returns {Array<{provider: string, model: string, labels: string[]}>}
 */
export function normalizeTags(raw) {
  const byKey = new Map()
  if (!Array.isArray(raw)) return []
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const provider = nonEmpty(entry.provider)
    const model = nonEmpty(entry.model)
    if (provider.length === 0 || model.length === 0) continue
    const labels = cleanLabels(entry.labels)
    if (labels.length === 0) continue
    const key = routeKey(provider, model)
    if (byKey.has(key)) continue
    byKey.set(key, { provider, model, labels })
  }
  return [...byKey.values()].slice(0, MAX_ROUTES)
}

/**
 * Render the tag section. Delegable routes are marked with the Session's
 * current child-model policy; tagged routes outside it still describe the
 * model but cannot be passed to `subagent`.
 *
 * @param {{tags: ReadonlyArray<{provider: string, model: string, labels: string[]}>, allowed?: ReadonlySet<string>, toolName?: string}} input
 * @returns {string} section text, or '' when no tagged route remains.
 */
export function renderTagsSection({ tags, allowed = new Set(), toolName = 'subagent' }) {
  const lines = []
  const untagged = []
  for (const tag of tags) {
    const delegable = allowed.has(routeKey(tag.provider, tag.model))
    lines.push(`- \`${tag.provider}/${tag.model}\` — ${tag.labels.join(', ')}${delegable ? ' (delegable)' : ''}`)
  }
  if (lines.length === 0) return ''
  for (const key of allowed) {
    if (!tags.some((tag) => routeKey(tag.provider, tag.model) === key)) {
      untagged.push(key.split('\u0000').map((part) => `\`${part}\``).join('/'))
    }
  }
  const body = [
    '## Model semantics',
    '',
    "The user attached these tags to model routes; treat them as the user's authoritative routing description:",
    ...lines,
    '',
    'Prefer a route whose tags mark it low-cost, cheap, fast, private, or flat-rate for high-repetition, low-difficulty work: mechanical edits repeated across many files, format or schema conversions, bulk renames, extracting fields from already-structured data, drafting many short enumerable items. Match a specialized tag only when the task needs that specialty — a code-specialized route for bulk code work, a multimodal route only for image-bearing tasks. Keep judgment work on the current model: architecture, ambiguous requirements, cross-file design, debugging without a clear cause, and final review of what a cheap route produced.',
    '',
    `Routes marked "delegable" are the ones this Session lets \`${toolName}\` select; pass the exact \`provider\` and \`model\`, and use \`list_subagent_models\` to confirm ids and reasoning efforts. Check a cheap route's output and run the same verification you would run yourself; if it fails twice, finish the work on the current model.`,
  ]
  if (untagged.length > 0) {
    body.push('', `This Session also allows untagged routes for subagents; the plugin's default treats those as privately deployed capacity without per-token billing: ${untagged.join(', ')}.`)
  }
  return body.join('\n')
}

/**
 * Render the no-tags fallback: every route the Session allows for subagents is
 * described as private, non-metered capacity.
 *
 * @param {{allowed: ReadonlySet<string>, toolName?: string}} input
 * @returns {string} section text, or '' when the Session allows no route.
 */
export function renderPrivateSection({ allowed, toolName = 'subagent' }) {
  if (allowed.size === 0) return ''
  const bullets = [...allowed].map((key) => {
    const [provider, model] = key.split('\u0000')
    return `- \`${provider}/${model}\``
  })
  return [
    '## Private model routes',
    '',
    'The user marked these child-model routes as privately deployed capacity that is not billed per token:',
    ...bullets,
    '',
    `Prefer one of them for high-repetition, low-difficulty work: mechanical edits repeated across many files, format or schema conversions, bulk renames, extracting fields from already-structured data, drafting many short enumerable items — work whose steps are settled before it starts. Delegate it with \`${toolName}\` and pass that exact \`provider\` and \`model\`; add \`reasoning_effort\` only when the route needs one.`,
    '',
    'Keep judgment work on the current model: architecture, ambiguous requirements, cross-file design, debugging without a clear cause, and final review of what the cheap route produced.',
    '',
    'Cheap capacity usually means less capability. Check its output, read the files it changed, and run the same verification you would run yourself. If a route fails twice or its result looks wrong, finish the work on the current model instead of retrying there.',
    '',
    '`list_subagent_models` lists the routes and reasoning efforts this Session allows.',
  ].join('\n')
}

export { routeKey }
