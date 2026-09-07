# Agent Note: DeepSeek 网关请求体上限诊断

Status: implemented

English | [中文](2026-09-07-gateway-request-body-limit.zh.md)

## Problem

The public `/api/v1/chat/completions` route rejected large serialized chat requests at the Nginx edge with HTTP 413 before the Models service could classify or process them. The adapter mapped every 413 to `INVALID_REQUEST`, so the session showed a generic failure and compaction did not receive a context-overflow signal.

## Decision

The public Nginx `/api/` location accepts request bodies up to 25 MiB, matching the existing `/ai/` and `/mcp/` routes. The direct DeepSeek adapter maps a 413 with explicit context-capacity wording to `CONTEXT_WINDOW_EXCEEDED`; other 413 responses use `REQUEST_BODY_TOO_LARGE`. A body-size rejection without a provider message uses a fixed diagnostic and never copies gateway HTML into the error.

## Alternatives considered

**Switch the desktop endpoint from `/api/v1` to `/ai/v1`.** Rejected because `/api/v1` is the documented Models-backed public endpoint used by the desktop profile, and changing the route would alter deployment ownership rather than correct the missing edge limit.

**Treat every 413 as context overflow.** Rejected because an edge byte limit is distinct from the model's token context capacity; conflating them would trigger compaction for an infrastructure limit and obscure deployment misconfiguration.

**Increase the Nginx limit without changing adapter diagnostics.** Rejected because any uncoordinated gateway or provider 413 would remain mislabeled as `INVALID_REQUEST`, preserving the failure's misleading user-visible diagnosis.

## Consequences

Requests up to 25 MiB can reach the Models gateway on `/api/`; deployment must fetch and activate this committed Nginx configuration before the public threshold changes. The new error code is terminal and is not automatically retried, preventing repeated transmission of an unchanged oversized body. Explicit provider context errors continue to use the existing compaction recovery path.

## Verification

An unauthenticated live request established the former edge threshold at exactly 1 MiB: a 1,048,556-byte body reached authentication, while a 1,048,580-byte body returned Nginx 413. Focused adapter tests cover 400 and 413 context wording, body-size classification, and the sanitized gateway diagnostic.
