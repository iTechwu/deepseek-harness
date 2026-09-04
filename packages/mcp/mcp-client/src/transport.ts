/**
 * Transport factory: creates the appropriate MCP transport based on the
 * plugin's resolved config. Stdio spawns a child process (with credential
 * scrubbing); Streamable HTTP connects to a URL.
 *
 * @module
 */

import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { Context } from '@deepseek-ai/cordis'
import type { Config } from './index.ts'

/**
 * The subprocess seam's scrubbed parent env (credential-shaped and stale
 * `DSH_*` names dropped), plus the spec's explicit env. The MCP SDK owns the
 * actual spawn, so this transport shares the scrub definition rather than the
 * spawn path.
 */
function buildChildEnv(extra: Record<string, string>): Record<string, string> {
  return { ...scrubbedParentEnv(), ...extra }
}

/**
 * Create an MCP transport from the resolved plugin config.
 *
 * @param config - Resolved plugin config discriminated on `transport`.
 * @returns A connected-ready MCP Transport (stdio or Streamable HTTP).
 */
export function createTransport(config: Config, ctx?: Context): Transport {
  switch (config.transport) {
    case 'stdio':
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: buildChildEnv(config.env),
        cwd: config.cwd,
      })
    case 'streamable-http':
      // The MCP SDK's StreamableHTTPClientTransport has optional callback
      // properties typed without `| undefined` (exactOptionalPropertyTypes
      // mismatch with the Transport interface); the SDK constructed the
      // object, so the cast records only that widening.
      return new StreamableHTTPClientTransport(
        new URL(config.url),
        {
          requestInit: { headers: config.headers },
          ...(config.authorizationCredential
            ? { fetch: createCredentialFetch(requiredContext(ctx), config.authorizationCredential) }
            : {}),
        },
      ) as Transport
  }
}

function requiredContext(ctx: Context | undefined): Context {
  if (!ctx) throw new Error('mcp-client: authorizationCredential requires a plugin context')
  return ctx
}

function createCredentialFetch(ctx: Context, credentialName: string): typeof fetch {
  const ref = credentialRef(credentialName)
  return async (input, init) => {
    const credentials = ctx.get('credentials')
    const resolved = await credentials?.resolve(ref)
    if (!resolved) {
      throw new Error(`mcp-client: credential reference ${credentialName} is not configured`)
    }
    const headers = new Headers(init?.headers)
    headers.set('Authorization', `Bearer ${resolved.value}`)
    return globalThis.fetch(input, { ...init, headers })
  }
}
