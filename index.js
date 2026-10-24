import z from '@deepseek-ai/schemastery'
import { normalizeTags, renderPrivateSection, renderTagsSection, routeKey } from './guidance.js'

const TOOL_NAME = 'subagent'

/**
 * The settings namespace the Models page card edits. `tags` is volatile, so a
 * write updates this running reference without remounting the plugin.
 */
export const Config = z.object({
  tags: z.array(z.object({
    provider: z.string().min(1).required(),
    model: z.string().min(1).required(),
    labels: z.array(z.string()).default([]),
  })).default([]).volatile(),
})

export const inject = ['systemPrompt', 'tools']

function sectionOrder(ctx) {
  try {
    const base = ctx.systemPrompt.getSectionOrder('TOOL_SUBAGENT')
    return Number.isFinite(base) ? base + 1 : 500
  } catch {
    return 500
  }
}

/** Read the live tag list behind the volatile reference. */
function readTags(config) {
  const value = config === undefined || config === null ? undefined : config.tags
  const plain = value !== null && typeof value === 'object' && typeof value.get === 'function' ? value.get() : value
  return normalizeTags(plain)
}

/** The exact child-model routes this Session authorizes for `subagent`. */
function allowedRoutes(ctx) {
  const settings = typeof ctx.get === 'function' ? ctx.get('subagentModelSelection') : undefined
  if (settings === undefined || typeof settings.current !== 'function') return new Set()
  try {
    const current = settings.current()
    if (current === null || typeof current !== 'object') return new Set()
    if (current.enabled !== true || !Array.isArray(current.allowedModels)) return new Set()
    return new Set(current.allowedModels.map((route) => routeKey(route.provider, route.model)))
  } catch {
    return new Set()
  }
}

/** Whether this Session's delegation tool exposes provider/model fields. */
function selectsChildModel(ctx, toolName, context) {
  const tool = ctx.tools.get(toolName, context.scope)
  const parameters = tool?.parameters ?? tool?.schema?.parameters
  return parameters !== undefined && parameters !== null && typeof parameters === 'object' && 'provider' in parameters
}

/**
 * Register the guidance section. Tags describe models whether or not this
 * Session can delegate; the private-route fallback appears only when the
 * Session allows child-model selection and no tags describe those routes.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{tags?: unknown}} config
 */
export function apply(ctx, config = {}) {
  const order = sectionOrder(ctx)
  ctx.systemPrompt.section({
    name: 'private-model-routing',
    order,
    text: (context) => {
      const tags = readTags(config)
      const allowed = selectsChildModel(ctx, TOOL_NAME, context) ? allowedRoutes(ctx) : new Set()
      if (tags.length > 0) return renderTagsSection({ tags, allowed, toolName: TOOL_NAME })
      return renderPrivateSection({ allowed, toolName: TOOL_NAME })
    },
  })
}
