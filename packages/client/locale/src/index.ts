/** Host registration for the browser locale preference. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { LOCALE_SETTINGS_NAMESPACE, LocaleSettingsSchema } from './locale-settings.ts'

export {
  LOCALE_IDS, LOCALE_PREFERENCE_FIELD, LOCALE_SETTINGS_NAMESPACE,
  type BuiltInLocaleId, type LocaleId, type LocaleSettings,
} from './locale-settings.ts'

const LANGUAGE_PROMPT_SECTION = 'preference:response-language'

/** Render the model-facing response-language instruction for one explicit preference. */
function responseLanguagePrompt(preference: 'zh' | 'en'): string {
  if (preference === 'zh') {
    return '请始终使用中文回答用户。解释、总结、状态更新和其他面向用户的自然语言内容使用中文。代码、命令、路径、标识符、文件内容和引用文本保持原样；除非用户明确要求其他语言，否则不要切换语言。'
  }
  return 'Always answer the user in English. Use English for explanations, summaries, status updates, and other user-facing natural-language content. Keep code, commands, paths, identifiers, file contents, and quoted text unchanged; do not switch languages unless the user explicitly asks for another language.'
}

/**
 * Register the durable locale section and dynamic model response-language prompt
 * when a settings provider and system-prompt service exist.
 * @param ctx - Host context whose optional services own the section and prompt.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    const localeScope = settingsCtx.settings.register(
      LOCALE_SETTINGS_NAMESPACE,
      LocaleSettingsSchema,
    )
    settingsCtx.inject(['systemPrompt'], (promptCtx) => {
      promptCtx.systemPrompt.section({
        name: LANGUAGE_PROMPT_SECTION,
        order: -90,
        text: () => {
          const preference = localeScope.get().preference
          // Custom locale ids carry no built-in prompt wording.
          return preference === 'zh' || preference === 'en' ? responseLanguagePrompt(preference) : ''
        },
      })
    })
  })
}
