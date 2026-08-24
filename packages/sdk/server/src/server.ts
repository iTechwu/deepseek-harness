/**
 * JSON-RPC methods and notifications for out-of-process harness SDKs.
 * The surrounding context owns plugins, persistence, and configured adapters.
 *
 * @module @deepseek-ai/dsh-sdk-jsonrpc-server/server
 */

import type { Context } from '@deepseek-ai/cordis'
import { resolve } from 'node:path'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { AgentCancelCause } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type CallId } from '@deepseek-ai/dsh-llm'
import { createLaunchEnvironmentSnapshot, DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import { setApprovalPolicy, type ApprovalOutcome, type ApprovalRequestId } from '@deepseek-ai/dsh-user-approval'
import { carrierKeyOf, type Scoped } from '@deepseek-ai/dsh-scope'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentRunEndInfo } from '@deepseek-ai/dsh-subagent'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import type {
  InitializeParams,
  InitializeResult,
  JsonRpcTransportPeer,
  SessionEventNotification,
  SessionCancelledNotification,
  ApprovalRequestNotification,
  ApprovalRespondParams,
  ApprovalRespondResult,
  SessionApprovalPolicyParams,
  SessionApprovalPolicyResult,
  SessionCancelParams,
  SessionCancelResult,
  SessionCloseParams,
  SessionCloseResult,
  SessionResumeParams,
  SessionResumeResult,
  SessionPromptParams,
  SessionPromptResult,
  SubagentFinishedNotification,
  SubagentStartedNotification,
} from '@deepseek-ai/dsh-sdk-protocol'

interface SessionRecord {
  handle: AgentHandle
  environment: Readonly<Record<string, string>>
  cwd: string
}

// Task-scoped environment is isolated per session by overlay. The SDK runtime
// is driven only by the trusted harness host, so the per-session overlay may
// carry task-scoped Skill/credential/gateway values; it still rejects the
// loader/interpreter-injection keys that could change how the runtime itself
// executes (mirrors the host's `stripDeepSeekJsonRpcUnsafeEnvironment`).
const SESSION_ENVIRONMENT_DENY_KEYS = new Set([
  'BASH_ENV',
  'ENV',
  'GCONV_PATH',
  'JAVA_TOOL_OPTIONS',
  'JDK_JAVA_OPTIONS',
  'LD_AUDIT',
  'LD_LIBRARY_PATH',
  'LD_PRELOAD',
  'NODE_OPTIONS',
  'NODE_PATH',
  'PERL5LIB',
  'PERL5OPT',
  'PYTHONHOME',
  'PYTHONPATH',
  'PYTHONSTARTUP',
  'RUBYLIB',
  'RUBYOPT',
  'ZDOTDIR',
  '_JAVA_OPTIONS',
])
const SESSION_ENVIRONMENT_VALUE_LIMIT = 2048

function normalizeSessionEnvironment(value: unknown): Readonly<Record<string, string>> {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('session environment must be an object')
  }
  const result: Record<string, string> = {}
  for (const [name, raw] of Object.entries(value)) {
    const normalized = name.toUpperCase()
    if (SESSION_ENVIRONMENT_DENY_KEYS.has(normalized) || normalized.startsWith('DYLD_')) {
      throw new Error(`session environment variable is not allowed: ${name}`)
    }
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > SESSION_ENVIRONMENT_VALUE_LIMIT) {
      throw new TypeError(`session environment value for ${name} must be a non-empty bounded string`)
    }
    result[name] = raw
  }
  return Object.freeze(result)
}

function sameEnvironment(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  return aKeys.length === bKeys.length && aKeys.every(key => a[key] === b[key])
}

function normalizeSessionCwd(value: unknown, fallback: string): string {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('session cwd must be a non-empty string')
  }
  return resolve(value)
}

interface PendingApproval {
  sessionId: string
  approvalId: ApprovalRequestId
  settle: (outcome: ApprovalOutcome) => void
}

/** Find the newest undecided, unclaimed `approval/asked` id for one ask. */
function findApprovalId(
  events: readonly SessionEvent[],
  callId: CallId | undefined,
  claimed: ReadonlySet<string>,
): ApprovalRequestId | undefined {
  const decided = new Set<ApprovalRequestId>()
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i] as SessionEvent
    if (event.type === 'approval/decided') {
      decided.add(event.data.id)
    } else if (event.type === 'approval/asked') {
      if (decided.has(event.data.id) || claimed.has(String(event.data.id))) continue
      if ((callId ?? null) !== (event.data.callId ?? null)) continue
      return event.data.id
    }
  }
  return undefined
}

/** Recover the delegating parent from the service-owned scoped carrier. */
function subagentParentOf(carrier: Scoped<SubagentRuntime>): Agent {
  return carrierKeyOf(carrier) as Agent
}

/** Deployment-specific status mapping for SDK turn and subagent outcomes. */
export interface HarnessSdkJsonRpcServerOptions {
  /** Report max-token termination as an accepted result instead of an infrastructure error. */
  maxTokensAsSuccess?: boolean
}

function successStatus(reason: string, options: HarnessSdkJsonRpcServerOptions): 'ok' | 'error' {
  if (reason === 'completed') return 'ok'
  return reason === 'max-tokens' && options.maxTokensAsSuccess === true ? 'ok' : 'error'
}

/**
 * SDK server over one booted harness context and transport peer. Construction
 * subscribes to session, agent, and subagent lifecycle events until shutdown;
 * reinitialization is unsupported.
 */
export class HarnessSdkJsonRpcServer {
  private cwd = process.cwd()
  private provider = 'deepseek-official'
  private model = 'deepseek-official'
  private maxTokens: number | undefined
  private llmFiber: { dispose(): Promise<void> } | undefined
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly sessionCreations = new Map<string, Promise<SessionRecord>>()
  private readonly pendingApprovals = new Map<string, PendingApproval>()
  private readonly disposers: (() => void)[] = []
  private shutdownTask: Promise<Record<string, never>> | undefined
  private shuttingDown = false

  constructor(
    private readonly ctx: Context,
    private readonly transport: JsonRpcTransportPeer,
    private readonly options: HarnessSdkJsonRpcServerOptions = {},
  ) {
    const serverOptions = this.options
    this.disposers.push(ctx.on('session/event', (session, event) => {
      const payload: SessionEventNotification = { sessionId: String(session.id), event }
      this.transport.notify('session.event', payload)
      if (event.type === 'turn/end' && event.data.reason.kind === 'aborted') {
        const cause = event.data.reason.reason
        const cancelled: SessionCancelledNotification = {
          sessionId: String(session.id),
          turn: event.data.turn,
          cause: cause.kind === 'hook' ? 'hook' : cause.kind,
          ...(cause.kind === 'hook' ? { hookReason: cause.reason } : {}),
        }
        this.transport.notify('session.cancelled', cancelled)
      }
    }))
    this.disposers.push(ctx.on('agent/status', ({ agent, status }) => {
      this.transport.notify('session.status', { sessionId: String(agent.session.id), status })
    }))
    this.disposers.push(ctx.on('session/created', (session) => {
      const parentSession = session.header.parentSession
      if (parentSession === undefined) return
      const payload: SubagentStartedNotification = {
        parentSessionId: String(parentSession),
        childSessionId: String(session.id),
      }
      this.transport.notify('subagent.started', payload)
    }))
    this.disposers.push(ctx.on('subagent/end', function (this: Scoped<SubagentRuntime>, info: SubagentRunEndInfo) {
      const parent = subagentParentOf(this)
      // This protocol reports only in-process child sessions. The service
      // snapshots the provider name and local flag through child disposal;
      // matching ids or parent lineage alone never establishes locality.
      if (!info.local) return
      const payload: SubagentFinishedNotification = {
        provider: info.provider,
        agentId: String(info.id),
        parentSessionId: String(parent.session.id),
        childSessionId: String(info.id),
        status: successStatus(info.stopReason, serverOptions),
        stopReason: info.stopReason,
        ...(info.lastAssistantMessage === undefined ? {} : { lastAssistantMessage: info.lastAssistantMessage }),
      }
      transport.notify('subagent.finished', payload)
    }))
    this.disposers.push(ctx.on('approval/request', (req, next) => {
      // Bridge only SDK-owned sessions; foreign asks delegate to the answerer chain.
      const sessionId = String(req.agent.session.id)
      if (!this.sessions.has(sessionId)) return next()
      if (req.signal?.aborted === true) return Promise.resolve<ApprovalOutcome>('cancelled')
      const claimed = new Set<string>()
      for (const key of this.pendingApprovals.keys()) claimed.add(key)
      const approvalId = findApprovalId(req.agent.session.events, req.callId, claimed)
      if (approvalId === undefined) return next()
      const key = String(approvalId)
      this.transport.notify('approval.request', {
        sessionId,
        approvalId: key,
        toolName: req.toolName,
        ...(req.callId === undefined ? {} : { callId: req.callId }),
        ...(req.reason === undefined ? {} : { reason: req.reason }),
      } satisfies ApprovalRequestNotification)
      return new Promise<ApprovalOutcome>((resolve) => {
        let settled = false
        const onAbort = (): void => { settle('cancelled') }
        const settle = (outcome: ApprovalOutcome): void => {
          if (settled) return
          settled = true
          this.pendingApprovals.delete(key)
          req.signal?.removeEventListener('abort', onAbort)
          resolve(outcome)
        }
        req.signal?.addEventListener('abort', onAbort, { once: true })
        this.pendingApprovals.set(key, { sessionId, approvalId, settle })
      })
    }))
  }

  /**
   * Configure the SDK route, mounting the DeepSeek fallback only when unowned.
   * @param params - SDK handshake parameters.
   * @returns server identity for the handshake.
   */
  async initialize(params: InitializeParams): Promise<InitializeResult> {
    if (params.protocolVersions !== undefined
      && (!Array.isArray(params.protocolVersions) || !params.protocolVersions.includes('2.0'))) {
      throw new TypeError('initialize does not support any requested protocol version')
    }
    if (params.maxTokens !== undefined
      && (!Number.isSafeInteger(params.maxTokens) || params.maxTokens <= 0)) {
      throw new TypeError('initialize maxTokens must be a positive safe integer')
    }
    this.cwd = resolve(params.cwd)
    this.provider = params.provider
    this.model = params.model
    this.maxTokens = params.maxTokens
    if (!this.hasAdapterFor(this.provider) && this.provider !== 'deepseek-official') {
      throw new Error(`no adapter registered for provider "${this.provider}"`)
    }
    return {
      serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' },
      ...(params.protocolVersions ? { protocolVersion: '2.0' } : {}),
    }
  }

  /**
   * Queue one identified prompt without assigning later activity to it.
   * @param params - target session and user content.
   * @returns the durable message identity.
   */
  async prompt(params: SessionPromptParams): Promise<SessionPromptResult> {
    const environment = normalizeSessionEnvironment(params.environment)
    const cwd = normalizeSessionCwd(params.cwd, this.cwd)
    const rec = await this.getOrCreateSession(params.sessionId, environment, cwd)
    // An agent-loop-only reload disposes the loop's agents while this record
    // survives; a retained agent accepts followup() silently, so validate the
    // record against the live registry before delivery (as the ACP bridge does).
    if (this.ctx.agents.get(rec.handle.agent.id) !== rec.handle.agent) {
      throw new Error(`session agent was disposed outside the server: ${params.sessionId}`)
    }
    const message = createUserMessage({ content: params.contentBlocks, source: { kind: 'user' } })
    rec.handle.agent.followup(message)
    return { messageId: message.id }
  }

  /** Abort active work for one live session and retain the runtime process. */
  async cancel(params: SessionCancelParams): Promise<SessionCancelResult> {
    const rec = this.sessions.get(params.sessionId)
    if (rec === undefined) throw new Error(`unknown SDK session: ${params.sessionId}`)
    const cause: AgentCancelCause = params.reason === 'parent'
      ? { kind: 'parent' }
      : params.reason === 'timeout' || params.reason === 'operator'
        ? { kind: 'hook', reason: params.reason }
        : { kind: 'user' }
    rec.handle.agent.cancel(cause, { keepInbox: params.keepInbox === true })
    return { cancelled: true }
  }

  /** Load a persisted session through the agent factory's resume path. */
  async resume(params: SessionResumeParams): Promise<SessionResumeResult> {
    if (this.sessions.has(params.sessionId)) return { sessionId: params.sessionId, resumed: true }
    if (this.shuttingDown) throw new Error('SDK server is shutting down')
    const handle = await this.ctx.agents.resume({
      resumeSessionId: SessionId(params.sessionId),
      agentOptions: {
        provider: this.provider,
        model: this.model,
        ...this.maxTokens === undefined ? {} : { maxTokens: this.maxTokens },
      },
      setup: async (agentCtx) => {
        if (this.provider === 'deepseek-official' && !this.hasAdapterFor(agentCtx)) {
          await agentCtx.plugin(LlmDeepSeek, {})
        }
      },
    })
    this.sessions.set(params.sessionId, { handle, environment: {}, cwd: String(handle.agent.session.header.cwd ?? this.cwd) })
    return { sessionId: params.sessionId, resumed: true }
  }

  /** Persist a session-scoped approval policy through the existing service. */
  async approvalPolicy(params: SessionApprovalPolicyParams): Promise<SessionApprovalPolicyResult> {
    const rec = this.sessions.get(params.sessionId)
    if (rec === undefined) throw new Error(`unknown SDK session: ${params.sessionId}`)
    setApprovalPolicy(rec.handle.agent.session, params.policy)
    return { sessionId: params.sessionId, policy: params.policy }
  }

  /** Dispose one live session without shutting down the runtime process. */
  async closeSession(params: SessionCloseParams): Promise<SessionCloseResult> {
    const rec = this.sessions.get(params.sessionId)
    if (rec === undefined) throw new Error(`unknown SDK session: ${params.sessionId}`)
    this.sessions.delete(params.sessionId)
    await rec.handle.dispose()
    return { sessionId: params.sessionId, closed: true }
  }

  /** Resolve one pending approval question with the host's outcome. */
  approvalRespond(params: ApprovalRespondParams): ApprovalRespondResult {
    const pending = this.pendingApprovals.get(params.approvalId)
    if (pending === undefined) throw new Error(`unknown approval: ${params.approvalId}`)
    pending.settle(params.outcome)
    return { sessionId: params.sessionId, approvalId: params.approvalId, outcome: params.outcome }
  }

  /**
   * Dispose server-owned agents, adapter, and subscriptions to quiescence.
   * The surrounding context remains running.
   * @returns empty JSON-RPC result.
   */
  shutdown(): Promise<Record<string, never>> {
    this.shutdownTask ??= this.performShutdown()
    return this.shutdownTask
  }

  private async performShutdown(): Promise<Record<string, never>> {
    this.shuttingDown = true
    for (const pending of [...this.pendingApprovals.values()]) pending.settle('cancelled')
    this.pendingApprovals.clear()
    const pendingCreations = [...this.sessionCreations.values()]
    await Promise.allSettled(pendingCreations)
    this.sessionCreations.clear()
    const records = [...this.sessions.values()]
    this.sessions.clear()
    const failures: unknown[] = []
    while (this.disposers.length > 0) {
      try {
        this.disposers.pop()?.()
      } catch (error) {
        failures.push(error)
      }
    }
    const teardownResults = await Promise.allSettled([
      ...records.map(rec => Promise.resolve().then(() => rec.handle.dispose())),
      ...(this.llmFiber === undefined ? [] : [Promise.resolve().then(() => this.llmFiber?.dispose())]),
    ])
    this.llmFiber = undefined
    failures.push(...teardownResults
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map(result => result.reason as unknown))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'SDK server teardown failed')
    return {}
  }

  /**
   * Dispatch one incoming JSON-RPC request to its typed handler. Throws (→ a
   * JSON-RPC error response) on an unknown method.
   * @param method - the JSON-RPC method name.
   * @param params - the raw params object from the wire.
   * @returns the handler's result, to be serialized as the response.
   */
  async handleRequest(method: string, params: Record<string, unknown> | undefined): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return this.initialize(params as unknown as InitializeParams)
      case 'session/prompt':
        return this.prompt(params as unknown as SessionPromptParams)
      case 'session/cancel':
        return this.cancel(params as unknown as SessionCancelParams)
      case 'session/resume':
        return this.resume(params as unknown as SessionResumeParams)
      case 'session/approval-policy':
        return this.approvalPolicy(params as unknown as SessionApprovalPolicyParams)
      case 'session/close':
        return this.closeSession(params as unknown as SessionCloseParams)
      case 'approval/respond':
        return this.approvalRespond(params as unknown as ApprovalRespondParams)
      case 'shutdown':
        return this.shutdown()
      default:
        throw new Error(`unknown DeepSeek Harness SDK runtime method: ${method}`)
    }
  }

  private async getOrCreateSession(sessionId: string, environment: Readonly<Record<string, string>>, cwd: string): Promise<SessionRecord> {
    if (this.shuttingDown) throw new Error('SDK server is shutting down')
    const existing = this.sessions.get(sessionId)
    if (existing) {
      if (!sameEnvironment(existing.environment, environment)) {
        throw new Error(`session environment is immutable after creation: ${sessionId}`)
      }
      if (existing.cwd !== cwd) {
        throw new Error(`session cwd is immutable after creation: ${sessionId}`)
      }
      return existing
    }
    const pending = this.sessionCreations.get(sessionId)
    if (pending) return pending
    const creation = this.createSession(sessionId, environment, cwd)
    this.sessionCreations.set(sessionId, creation)
    void creation.then(
      () => { this.sessionCreations.delete(sessionId) },
      () => { this.sessionCreations.delete(sessionId) },
    )
    return creation
  }

  private async createSession(sessionId: string, environment: Readonly<Record<string, string>>, cwd: string): Promise<SessionRecord> {
    // No preset composition: this server's compositions keep the model-facing
    // rows in the host plane, so this agent reads them from the global layer. A
    // deployment that configures a roster has to join one here first
    // (@deepseek-ai/dsh-agent-presets README, "Composing a child agent").
    const handle = await this.ctx.agents.create({
      sessionId: SessionId(sessionId),
      meta: { cwd },
      agentOptions: {
        provider: this.provider,
        model: this.model,
        ...this.maxTokens === undefined ? {} : { maxTokens: this.maxTokens },
      },
      setup: async (agentCtx) => {
        if (Object.keys(environment).length > 0) {
          if (this.hasAdapterFor(agentCtx)) {
            throw new Error('session environment requires an unowned scoped DeepSeek adapter')
          }
          const values = { ...process.env as Record<string, string>, ...environment }
          agentCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([{ source: 'process', values }]))
        }
        if (this.provider === 'deepseek-official' && !this.hasAdapterFor(agentCtx)) {
          await agentCtx.plugin(LlmDeepSeek, {})
        }
      },
    })
    const rec: SessionRecord = { handle, environment, cwd }
    this.sessions.set(sessionId, rec)
    return rec
  }

  private hasAdapterFor(subject: string | Context): boolean {
    const ctx = typeof subject === 'string' ? this.ctx : subject
    const provider = typeof subject === 'string' ? subject : this.provider
    return ctx.get('llm')?.listProviders().some(entry => entry.id === provider) ?? false
  }
}
