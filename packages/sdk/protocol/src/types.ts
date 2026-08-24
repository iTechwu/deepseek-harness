/**
 * Named wire types for the DeepSeek Harness SDK runtime protocol: the three
 * request/result pairs and the four server-to-client notification payloads
 * exchanged over the newline-delimited JSON-RPC stdio transport. The server
 * plugin (`@deepseek-ai/dsh-sdk-jsonrpc-server`) and SDK clients share these shapes;
 * `serverInfo.name` stays the wire-stable `deepseek-harness-sdk-runtime`.
 *
 * @module @deepseek-ai/dsh-sdk-protocol/types
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SubagentStopReason } from '@deepseek-ai/dsh-subagent'

/** Parameters for the process-wide SDK handshake. */
export interface InitializeParams {
  /** Working directory recorded on every SDK-created session's header. */
  cwd: string
  /** Provider route every SDK-created agent runs on. */
  provider: string
  /** Model name every SDK-created agent runs on (the server may mount a fallback adapter; see `HarnessSdkJsonRpcServer.initialize`). */
  model: string
  /** Optional positive output-token cap inherited by SDK-created agents and their in-process descendants. */
  maxTokens?: number
  /** Optional protocol versions supported by the caller, in preference order. */
  protocolVersions?: readonly string[]
}

/** Wire-stable server identity returned by initialization. */
export interface InitializeResult {
  /** Wire-stable server identity (`deepseek-harness-sdk-runtime`) and version. */
  serverInfo: { name: string; version: string }
  /** Version selected from `protocolVersions`, when the caller supplied one. */
  protocolVersion?: string
}

/** One user turn on one SDK session. */
export interface SessionPromptParams {
  /** The SDK-side session id; an unknown id lazily creates the agent+session pair. */
  sessionId: string
  /** The prompt content blocks, sent verbatim as the user message. */
  contentBlocks: ContentBlock[]
  /** Optional task-scoped session environment overlay. The server rejects loader/interpreter-injection keys (deny-list). */
  environment?: Readonly<Record<string, string>>
  /** Optional per-session working directory (absolute). Defaults to the initialize cwd; immutable after session creation. */
  cwd?: string
}

/** Durable enqueue receipt for one prompt. */
export interface SessionPromptResult {
  /** Identity of the queued user message. */
  messageId: string
}

/** Cancel the active work for one session while retaining or clearing queued input. */
export interface SessionCancelParams {
  sessionId: string
  reason?: 'user' | 'timeout' | 'parent' | 'operator'
  keepInbox?: boolean
}

/** Result of a session cancellation request. */
export interface SessionCancelResult {
  cancelled: boolean
}

/** Resume one persisted session into the current runtime process. */
export interface SessionResumeParams {
  sessionId: string
}

/** Result of a session resume request. */
export interface SessionResumeResult {
  sessionId: string
  resumed: true
}

/** Change the durable approval policy for one live session. */
export interface SessionApprovalPolicyParams {
  sessionId: string
  policy: 'ask' | 'never'
}

/** Result of a session approval-policy change. */
export interface SessionApprovalPolicyResult {
  sessionId: string
  policy: 'ask' | 'never'
}

/** Close one live session, disposing its agent and releasing its runtime resources. */
export interface SessionCloseParams {
  sessionId: string
}

/** Result of a session close request. */
export interface SessionCloseResult {
  sessionId: string
  closed: boolean
}

/** `session.cancelled` payload: a turn ended because a cancellation was applied. */
export interface SessionCancelledNotification {
  /** Session whose turn was cancelled. */
  sessionId: string
  /** The turn number that was closed by the cancellation. */
  turn: number
  /** The cancellation cause kind, flattened from the durable turn-end reason. */
  cause: 'user' | 'parent' | 'hook' | 'disposed' | 'legacy'
  /** Present only when `cause === 'hook'`; the hook-supplied reason. */
  hookReason?: string
}

/** `approval.request` payload: one pending approval question for the host to answer. */
export interface ApprovalRequestNotification {
  /** Session whose live turn asked for approval. */
  sessionId: string
  /** Durable id pairing this ask with its `approval/decided` audit event. */
  approvalId: string
  /** The tool the question is about. */
  toolName: string
  /** The exact tool call being decided, when the asker has one. */
  callId?: string
  /** The asker's human-readable explanation of why it is asking. */
  reason?: string
}

/** Answer one pending approval question. */
export interface ApprovalRespondParams {
  sessionId: string
  approvalId: string
  outcome: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
}

/** Result of an approval response. */
export interface ApprovalRespondResult {
  sessionId: string
  approvalId: string
  outcome: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
}

/** Deployment-mapped SDK outcome: `ok` for an accepted result, `error` otherwise. */
export type SdkRunStatus = 'ok' | 'error'

/** `session.event` payload: one session-log event, streamed as it is recorded. */
export interface SessionEventNotification {
  /** Session the event belongs to (every session in the runtime, not only SDK-created ones). */
  sessionId: string
  /** The full session-log event envelope. */
  event: SessionEvent
}

/** Whole-agent lifecycle state for one session. */
export interface SessionStatusNotification {
  /** Session whose live agent changed status. */
  sessionId: string
  /** The whole-agent state after the transition. */
  status: 'idle' | 'running'
}

/** `subagent.started` payload: an in-runtime child session was created. */
export interface SubagentStartedNotification {
  /** The delegating session. */
  parentSessionId: string
  /** The new child session. */
  childSessionId: string
}

/** `subagent.finished` payload: an in-process subagent run ended (remote runs are not reported). */
export interface SubagentFinishedNotification {
  /** Subagent provider name that ran the child. */
  provider: string
  /** The child agent's id (equals {@link childSessionId} for local runs). */
  agentId: string
  /** The delegating session. */
  parentSessionId: string
  /** The child session. */
  childSessionId: string
  /** Deployment-mapped run outcome. */
  status: SdkRunStatus
  /** The provider-reported stop reason. */
  stopReason: SubagentStopReason
  /** The child's selected assistant output; absent when the child produced none. */
  lastAssistantMessage?: ContentBlock[]
}

/** Server-to-client notifications by JSON-RPC method name. */
export interface HarnessSdkNotificationMap {
  'session.event': SessionEventNotification
  'session.status': SessionStatusNotification
  'session.cancelled': SessionCancelledNotification
  'approval.request': ApprovalRequestNotification
  'subagent.started': SubagentStartedNotification
  'subagent.finished': SubagentFinishedNotification
}

/** Client-to-server request methods with their param and result shapes. */
export interface HarnessSdkRequestMap {
  'initialize': { params: InitializeParams; result: InitializeResult }
  'session/prompt': { params: SessionPromptParams; result: SessionPromptResult }
  'session/cancel': { params: SessionCancelParams; result: SessionCancelResult }
  'session/resume': { params: SessionResumeParams; result: SessionResumeResult }
  'session/approval-policy': { params: SessionApprovalPolicyParams; result: SessionApprovalPolicyResult }
  'session/close': { params: SessionCloseParams; result: SessionCloseResult }
  'approval/respond': { params: ApprovalRespondParams; result: ApprovalRespondResult }
  'shutdown': { params: undefined; result: Record<string, never> }
}
