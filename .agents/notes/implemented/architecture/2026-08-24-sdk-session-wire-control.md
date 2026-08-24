# Agent Note: SDK session wire control

Status: implemented

## Decision

The SDK runtime exposes cancellation, persistence-backed resume, and durable approval-policy changes as session-owned JSON-RPC requests. `session/cancel` aborts the live Agent and does not close the subprocess. `session/resume` delegates to the existing `AgentRegistry.resume` factory so persistence ownership and setup rollback remain in one implementation. `session/approval-policy` appends the existing `approval/policy` event instead of inventing a second policy store.

The first prompt may carry a per-session environment overlay, but it is immutable after session creation and only allows `DEEPSEEK_BASE_URL`. Credentials, interpreter search paths, dynamic-loader variables, and arbitrary process environment mutation stay outside the wire contract. A scoped DeepSeek plugin consumes the overlay when the runtime does not already own a global adapter; a global adapter plus an overlay is rejected rather than silently ignoring the requested endpoint.

## Consequences

Both TypeScript SDK layers and the protocol type map expose the same methods. Approval *policy* is wire-controlled; individual approval decisions remain an answerer capability and are not synthesized without a request identity and durable audit pair. Per-session close is intentionally absent: cancellation is a work control operation, while `shutdown` remains process lifecycle teardown.
