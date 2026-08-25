/**
 * dsh-locale-zh: a host plugin that registers a system-prompt section forcing
 * the model to always reply to the user in Simplified Chinese.
 *
 * @module @dofe/dsh-locale-zh
 */
export const name = 'locale-zh'
export const inject = ['systemPrompt']
const ORDER = 1
const GUIDANCE = `语言：请始终使用简体中文与用户交流（包括思考、解释、工具调用说明、交付说明、报错说明）。除非用户明确要求改用其他语言。`
export function apply(ctx) {
  ctx.systemPrompt.section({ name: 'locale:zh', order: ORDER, text: GUIDANCE })
}
