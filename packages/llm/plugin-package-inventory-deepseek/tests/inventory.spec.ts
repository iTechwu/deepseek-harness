import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire, registerHooks } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { createScope } from '@deepseek-ai/dsh-scope'
import AgentPresets, { mountPreset } from '@deepseek-ai/dsh-agent-presets'
import DeepSeekLlmApiExtensionRegistry from '@deepseek-ai/dsh-deepseek-llm-api-extensions'
import * as PluginInventory from '../src/index.ts'

const contexts: Context[] = []
const roots: string[] = []
const SIGNAL = new AbortController().signal

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function packagePlugin(
  root: string,
  dir: string,
  manifest: object,
  source = 'export default () => {}\n',
): Promise<string> {
  const packageDir = join(root, dir)
  await mkdir(packageDir, { recursive: true })
  await writeFile(join(packageDir, 'package.json'), `${JSON.stringify({ type: 'module', ...manifest })}\n`)
  await writeFile(join(packageDir, 'plugin.mjs'), source)
  return `./${dir}/plugin.mjs`
}

async function harness(enabled?: boolean): Promise<{ ctx: Context; root: string; disposeInventory: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-packages-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(join(root, 'cordis.yml')).href
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentPresets, { default: 'fixture', roots: [], includeShippedRoot: false, includeUserRoot: false })
  await ctx.plugin(DeepSeekLlmApiExtensionRegistry)
  const inventory = enabled === undefined
    ? ctx.plugin(PluginInventory)
    : ctx.plugin(PluginInventory, { enabled })
  await inventory
  return { ctx, root, disposeInventory: () => inventory.dispose() }
}

describe('DeepSeek plugin package inventory', () => {
  it('contributes by default and can be explicitly disabled', async () => {
    const defaultHarness = await harness()
    const defaultFields = await defaultHarness.ctx.deepseekLlmApiExtensions.prepare({
      body: { messages: [] }, signal: SIGNAL,
    })
    expect(defaultFields.fields).toHaveProperty('dsh_plugin_packages')

    const disabledHarness = await harness(false)
    const disabledFields = await disabledHarness.ctx.deepseekLlmApiExtensions.prepare({
      body: { messages: [] }, signal: SIGNAL,
    })
    expect(disabledFields.fields).not.toHaveProperty('dsh_plugin_packages')
  })

  it('reports active package versions once, retains parallel versions, and excludes inactive or loose entries', async () => {
    const { ctx, root } = await harness()
    const oneA = await packagePlugin(root, 'one-a', { name: 'one', version: '1.0.0' })
    const oneB = await packagePlugin(root, 'one-b', { name: 'one', version: '2.0.0' })
    const disabled = await packagePlugin(root, 'disabled', { name: 'disabled', version: '1.0.0' })
    await mkdir(join(root, 'loose'), { recursive: true })
    await writeFile(join(root, 'loose/plugin.mjs'), 'export default () => {}\n')

    await ctx.loader.create({ name: oneA })
    await ctx.loader.create({ name: oneA })
    await ctx.loader.create({ name: oneB })
    await ctx.loader.create({ name: disabled, disabled: true })
    await ctx.loader.create({ name: './loose/plugin.mjs' })

    const prepared = await ctx.deepseekLlmApiExtensions.prepare({ body: { messages: [] }, signal: SIGNAL })
    expect(prepared.fields.dsh_plugin_packages).toEqual({
      version: 1,
      packages: [
        { name: 'one', version: '1.0.0' },
        { name: 'one', version: '2.0.0' },
      ],
    })
  })

  it('fails request preparation for an active package with malformed identity metadata', async () => {
    const { ctx, root } = await harness()
    const bad = await packagePlugin(root, 'bad', { name: 'bad' })
    await ctx.loader.create({ name: bad })
    await expect(ctx.deepseekLlmApiExtensions.prepare({ body: { messages: [] }, signal: SIGNAL }))
      .rejects.toThrow(/must declare non-empty name and version/)
  })

  it('omits a loose ESM module whose nearest manifest only marks the module type', async () => {
    const { ctx, root } = await harness()
    const marker = await packagePlugin(root, 'marker-only', {})
    await ctx.loader.create({ name: marker })
    await expect(ctx.deepseekLlmApiExtensions.prepare({ body: { messages: [] }, signal: SIGNAL }))
      .resolves.toMatchObject({ fields: { dsh_plugin_packages: { version: 1, packages: [] } } })
  })

  it('uses the host inventory when a request has no matching or joined live agent', async () => {
    const { ctx, root } = await harness()
    const plugin = await packagePlugin(root, 'host-only', { name: 'host-only', version: '3.0.0' })
    await ctx.loader.create({ name: plugin })
    const missing = await ctx.deepseekLlmApiExtensions.prepare({ body: { messages: [] }, signal: SIGNAL, sessionId: 'missing' })
    expect(missing.fields.dsh_plugin_packages?.packages).toEqual([{ name: 'host-only', version: '3.0.0' }])

    const id = SessionId('bare-agent')
    const agentScope = createScope(ctx, {})
    ctx.agents.register({ id, ctx: agentScope.ctx, session: { id } } as unknown as Agent)
    const bare = await ctx.deepseekLlmApiExtensions.prepare({ body: { messages: [] }, signal: SIGNAL, sessionId: id })
    expect(bare.fields.dsh_plugin_packages?.packages).toEqual([{ name: 'host-only', version: '3.0.0' }])
  })

  it('resolves scoped and unscoped bare subpaths, absolute/file modules, and skips URL or Cordis modules', async () => {
    const { ctx, root } = await harness()
    await packagePlugin(root, 'node_modules/plain-package', { name: 'plain-package', version: '1.0.0' })
    await packagePlugin(root, 'node_modules/@scope/scoped-package', { name: '@scope/scoped-package', version: '2.0.0' })
    await packagePlugin(root, 'absolute-package', { name: 'absolute-package', version: '3.0.0' })
    const absolute = join(root, 'absolute-package/plugin.mjs')
    const internal = ctx.loader.internal
    ctx.loader.internal = {
      version: 'v2',
      import: async (specifier: string, ...args: unknown[]) => {
        if (specifier === 'https://plugins.example/test.mjs') return { default: () => {} }
        // Node ESM on Windows requires a file URL; retain the raw Loader name for package attribution.
        const portableSpecifier = specifier === absolute ? pathToFileURL(specifier).href : specifier
        return await (internal as never as { import(specifier: string, ...args: unknown[]): Promise<unknown> })
          .import(portableSpecifier, ...args)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>

    await ctx.loader.create({ name: 'plain-package/plugin.mjs' })
    await ctx.loader.create({ name: '@scope/scoped-package/plugin.mjs' })
    await ctx.loader.create({ name: absolute })
    await ctx.loader.create({ name: pathToFileURL(absolute).href })
    ctx.loader.builtins.noop = () => {}
    await ctx.loader.create({ name: 'cordis:noop' })
    await ctx.loader.create({ name: 'https://plugins.example/test.mjs' })

    const prepared = await ctx.deepseekLlmApiExtensions.prepare({ body: { messages: [] }, signal: SIGNAL })
    expect(prepared.fields.dsh_plugin_packages?.packages).toEqual([
      { name: '@scope/scoped-package', version: '2.0.0' },
      { name: 'absolute-package', version: '3.0.0' },
      { name: 'plain-package', version: '1.0.0' },
    ])
  })

  it('fails when a Loader-resolved bare entry has no package manifest', async () => {
    const { ctx } = await harness()
    ctx.loader.internal = {
      version: 'v2',
      import: async () => ({ default: () => {} }),
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'missing-package' })
    await expect(ctx.deepseekLlmApiExtensions.prepare({ body: { messages: [] }, signal: SIGNAL }))
      .rejects.toThrow(/cannot resolve active package/)
  })

  it('reads identity metadata when the plugin keeps its manifest private', async () => {
    const { ctx, root } = await harness()
    await packagePlugin(root, 'node_modules/private-manifest', {
      name: 'private-manifest', version: '3.0.0', exports: './plugin.mjs',
    })
    await ctx.loader.create({ name: 'private-manifest' })
    const prepared = await ctx.deepseekLlmApiExtensions.prepare({ body: { messages: [] }, signal: SIGNAL })
    expect(prepared.fields.dsh_plugin_packages?.packages).toEqual([{ name: 'private-manifest', version: '3.0.0' }])
  })

  it('supports a direct embedding whose context has no base URL', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(Loader)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(DeepSeekLlmApiExtensionRegistry)
    await ctx.plugin(PluginInventory)
    const prepared = await ctx.deepseekLlmApiExtensions.prepare({ body: { messages: [] }, signal: SIGNAL })
    expect(prepared.fields.dsh_plugin_packages).toEqual({ version: 1, packages: [] })
  })

  it('uses each ordinary Loader tree base for conflicting bare package versions', async () => {
    const { ctx, root } = await harness()
    await packagePlugin(root, 'node_modules/versioned-plugin', {
      name: 'versioned-plugin', version: '1.0.0',
    })
    const nestedRoot = join(root, 'nested')
    await packagePlugin(nestedRoot, 'node_modules/versioned-plugin', {
      name: 'versioned-plugin', version: '2.0.0',
    })
    const composition = join(nestedRoot, 'cordis.yml')
    await writeFile(composition, '- id: nested\n  name: versioned-plugin/plugin.mjs\n')

    await ctx.loader.create({ name: 'versioned-plugin/plugin.mjs' })
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(composition).href } })

    const prepared = await ctx.deepseekLlmApiExtensions.prepare({ body: { messages: [] }, signal: SIGNAL })
    expect(prepared.fields.dsh_plugin_packages?.packages).toEqual([
      { name: 'versioned-plugin', version: '1.0.0' },
      { name: 'versioned-plugin', version: '2.0.0' },
    ])
  })

  it('honors an anchored package resolver before a shadowed physical installation', async () => {
    const { ctx, root } = await harness()
    await packagePlugin(root, 'node_modules/overlay-plugin', { name: 'overlay-plugin', version: '1.0.0' })
    await packagePlugin(root, 'selected', { name: 'overlay-plugin', version: '2.0.0' })
    const selectedManifest = join(root, 'selected/package.json')
    const originalManifest = createRequire(ctx.baseUrl!).resolve('overlay-plugin/package.json')
    const hooks = registerHooks({
      resolve(specifier, context, nextResolve) {
        if (context.parentURL === ctx.baseUrl && specifier.startsWith('overlay-plugin/')) {
          return { url: pathToFileURL(join(root, 'selected', specifier.slice('overlay-plugin/'.length))).href, shortCircuit: true }
        }
        return nextResolve(specifier, context)
      },
    })
    try {
      expect(createRequire(ctx.baseUrl!).resolve('overlay-plugin/package.json')).toBe(selectedManifest)
      await ctx.loader.create({ name: 'overlay-plugin/plugin.mjs' })
      const prepared = await ctx.deepseekLlmApiExtensions.prepare({ body: { messages: [] }, signal: SIGNAL })
      expect(prepared.fields.dsh_plugin_packages?.packages).toEqual([{ name: 'overlay-plugin', version: '2.0.0' }])
    } finally {
      hooks.deregister()
    }
    expect(createRequire(ctx.baseUrl!).resolve('overlay-plugin/package.json'))
      .toBe(originalManifest)
  })

  it.each(['ERR_MODULE_NOT_FOUND', 'ERR_INVALID_PACKAGE_CONFIG'])(
    'falls back only for missing manifest requests, preserving resolver error %s', async (code) => {
      const { ctx, root } = await harness()
      await packagePlugin(root, 'node_modules/resolver-error', { name: 'resolver-error', version: '1.0.0' })
      await ctx.loader.create({ name: 'resolver-error/plugin.mjs' })
      const failure = Object.assign(new Error('resolver refused the manifest'), { code })
      const hooks = registerHooks({
        resolve(specifier, context, nextResolve) {
          if (context.parentURL === ctx.baseUrl && specifier === 'resolver-error/package.json') throw failure
          return nextResolve(specifier, context)
        },
      })
      try {
        const preparation = ctx.deepseekLlmApiExtensions.prepare({ body: { messages: [] }, signal: SIGNAL })
        if (code === 'ERR_MODULE_NOT_FOUND') {
          await expect(preparation).resolves.toMatchObject({ fields: { dsh_plugin_packages: {
            packages: [{ name: 'resolver-error', version: '1.0.0' }],
          } } })
        } else {
          await expect(preparation).rejects.toThrow('resolver refused the manifest')
        }
      } finally {
        hooks.deregister()
      }
    },
  )

  it('mirrors the standing preset bare-package override instead of its local node_modules', async () => {
    const { ctx, root } = await harness()
    await packagePlugin(root, 'node_modules/preset-only', { name: 'preset-only', version: '4.0.0' })
    const presetDir = join(root, 'preset')
    await mkdir(presetDir, { recursive: true })
    await packagePlugin(presetDir, 'node_modules/preset-only', { name: 'preset-only', version: '9.0.0' })
    const composition = join(presetDir, 'agent.cordis.yml')
    await writeFile(composition, '- id: preset-only\n  name: preset-only/plugin.mjs\n')

    const standingKey = {}
    const standing = createScope(ctx, standingKey)
    await mountPreset(standing.ctx, { id: 'fixture', trust: 'user', path: composition })
    const agentKey = {}
    const agentScope = createScope(ctx, agentKey, { parent: standingKey })
    const id = SessionId('preset-agent')
    const agent = { id, ctx: agentScope.ctx, session: { id } } as unknown as Agent
    ctx.agents.register(agent)

    const prepared = await ctx.deepseekLlmApiExtensions.prepare({ body: { messages: [] }, signal: SIGNAL, sessionId: id })
    expect(prepared.fields.dsh_plugin_packages?.packages).toEqual([{ name: 'preset-only', version: '4.0.0' }])
  })

  it('withdraws the inventory field when the contributing plugin reloads', async () => {
    const { ctx, disposeInventory } = await harness()
    expect((await ctx.deepseekLlmApiExtensions.prepare({ body: { messages: [] }, signal: SIGNAL })).fields)
      .toHaveProperty('dsh_plugin_packages')
    await disposeInventory()
    expect((await ctx.deepseekLlmApiExtensions.prepare({ body: { messages: [] }, signal: SIGNAL })).fields)
      .not.toHaveProperty('dsh_plugin_packages')
  })
})
