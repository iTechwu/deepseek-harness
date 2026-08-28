import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import {
  LOCALE_SETTINGS_NAMESPACE, apply,
} from '@deepseek-ai/dsh-client-locale'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('locale host', () => {
  it('registers an open locale preference with the Host settings lifecycle', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = settingsNamespace(LOCALE_SETTINGS_NAMESPACE)
    expect(ctx.settings.get(ns)).toEqual({})
    await ctx.settings.update(ns, { preference: 'en' })
    expect(ctx.settings.get(ns)).toEqual({ preference: 'en' })
    await ctx.settings.update(ns, { preference: 'pt-BR' })
    expect(ctx.settings.get(ns)).toEqual({ preference: 'pt-BR' })
    await expect(ctx.settings.update(ns, { preference: 'bad locale' })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { preference: '123' })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })

  it('adds a live model response-language instruction only for an explicit preference', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    await ctx.plugin(SystemPrompt, { persona: '' }).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()

    expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toContain('Always answer')
    await ctx.settings.update(settingsNamespace(LOCALE_SETTINGS_NAMESPACE), { preference: 'zh' })
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('请始终使用中文回答用户')
    await ctx.settings.update(settingsNamespace(LOCALE_SETTINGS_NAMESPACE), { preference: 'en' })
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('Always answer the user in English')

    await fiber.dispose()
  })
})
