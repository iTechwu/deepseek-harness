# Agent Note: OpenMontage client-stage guidance

Status: implemented

English | [中文](2026-09-08-openmontage-client-stage-guidance.zh.md)

## Problem

The OpenMontage plugin explained how to submit and monitor a video Job but omitted the client-stage lifecycle required to execute selector and composition tools. A model could call `invoke_openmontage_tool` with only the logical tool operation and inputs, so the server received no Job or stage lease context and returned a generic MCP execution failure.

## Decision

The plugin prompt states the complete `submit_video_job` -> `begin_client_stage` -> zero or more stage-allowed `invoke_openmontage_tool` calls -> `submit_client_stage` sequence, including the no-invocation case for stages with an empty tool list. It maps the begin response's `jobId`, `stage`, `stageAttempt`, and `leaseToken` fields to the later tools' `job_id`, `stage`, `stage_attempt`, and `lease_token` arguments, and requires a stable non-empty `idempotency_key`. The begin response's `stageContract` is authoritative for the attempt: the model reads every `instructionFiles` entry, maps each result to a `{path, content_hash}` provenance entry, passes only exact `gatewayTools` names to the invocation tool, treats `declaredTools` as manifest vocabulary, and keys submitted artifacts by `produces`. The MCP bundle fixes its URL at the public gateway and resolves `MODELS_API_KEY` through the DSH credential service rather than reading process environment directly. The package README records the same caller obligations, and the plugin regression is part of the root Vitest inventory.

## Alternatives considered

**Rely only on OpenMontage tool descriptions.** Rejected because the host prompt determines tool sequencing before individual calls, and the missing lifecycle guidance had already produced context-free selector calls.

**Allow selector calls without a Job.** Rejected because Job attribution, stage authorization, lease fencing, idempotency, artifacts, and cost auditability depend on the existing client-stage lifecycle.

## Consequences

Models receive both an explicit lifecycle and a server-derived per-stage execution contract before choosing OpenMontage tools, while the server remains authoritative for lease validation. The prompt becomes longer, but it prevents paid or stateful operations from being attempted outside their Job and stage context.

## Verification

The root Vitest gate runs the plugin test and checks the ordered lifecycle, camel-case response to snake-case argument mapping, exact provenance-object construction, the distinction between manifest `declaredTools` and callable `gatewayTools`, the prohibited context-free argument set, and the absence of internal deployment addresses. The keyless recorded-session owner follows the current Session v2 writer instead of claiming historical migration coverage.
