/**
 * File-backed settings provider. One YAML or JSON document under the user's
 * harness home carries every namespace section; external edits hot-publish
 * through the seam, and every write re-reads the document under a
 * cross-process writer lock before patching it as a comment-preserving
 * leaf-level diff.
 * @module @deepseek-ai/dsh-settings-file
 */

import z from '@deepseek-ai/schemastery'
import { extname, join, resolve } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** Plugin config: file location and hot-reload behavior. */
export interface Config {
  /** Settings document path; defaults to `settings.yaml` under the harness home. */
  path?: string
  /** Harness home used when `path` is omitted; defaults to `$DSH_HOME` or `~/.dsh`. */
  dshHome?: string
  /** Watch the document and hot-publish external edits; defaults to true. */
  watch?: boolean
  /** Watcher write-settle window in milliseconds; defaults to 100. */
  debounceMs?: number
}

/** Document format derived from the configured file extension. */
type SettingsFormat = 'yaml' | 'json'

const FORMATS: Record<string, SettingsFormat> = {
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.json': 'json',
}

/** Fully resolved provider parameters; defaulting happens here, never inline. */
interface ResolvedSpec {
  filename: string
  format: SettingsFormat
  watch: boolean
  debounceMs: number
}

/**
 * Resolve the runtime spec from plugin config: an explicit `path` wins,
 * otherwise the document lives at `<harness home>/settings.yaml`.
 * @param config - raw plugin config.
 * @returns the resolved file location, format, and watch behavior.
 */
export function resolveSpec(config: Config): ResolvedSpec {
  const filename = resolve(config.path ?? join(resolveDshHome(config.dshHome), 'settings.yaml'))
  const format = FORMATS[extname(filename)]
  if (format === undefined) {
    throw new Error(`settings-file: extension "${extname(filename)}" is not supported (use .yaml, .yml, or .json)`)
  }
  return {
    filename,
    format,
    watch: config.watch ?? true,
    debounceMs: config.debounceMs ?? 100,
  }
}

/**
 * Apply the difference between one node's stored and next value as minimal
 * `setIn`/`deleteIn` edits, recursing through maps, so every untouched node —
 * and the key node of every changed pair — keeps its comments, anchors, and
 * formatting. Non-map values (arrays and scalars) replace wholesale when
 * unequal, taking any comments inside them along.
 */
/** File-backed settings provider (`settings.yaml`/`.json`). */
/**
 * Desktop editions address the profile settings document through the static
 * face only (`Config` + `resolveSpec`); the 0.1.6 provider runtime (hot
 * reload, writer lock, section publish) rode the removed `SettingsProvider`
 * service and is intentionally absent here.
 */
export class FileSettingsProvider {

  static Config: z<Config> = z.object({
    path: z.string(),
    dshHome: z.string(),
    watch: z.boolean().default(true),
    debounceMs: z.number().min(0).default(100),
  })
}

export default FileSettingsProvider
