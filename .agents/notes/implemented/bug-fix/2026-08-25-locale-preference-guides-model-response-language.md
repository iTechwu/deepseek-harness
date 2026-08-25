# Agent Note: Locale preference guides model response language

Status: implemented

English | [中文](2026-08-25-locale-preference-guides-model-response-language.zh.md)

## Problem

The browser language selector changed UI copy and `<html lang>`, but the selected language did not reach the model-facing prompt. A user who selected Chinese could therefore still receive natural-language responses in another language.

## Decision

The Host half of `@deepseek-ai/dsh-client-locale` registers a dynamic system-prompt section beside its existing `locale` settings namespace. Each prompt assembly reads the current explicit `locale.preference`: `zh` requests Chinese natural-language responses and `en` requests English. The instruction preserves code, commands, paths, identifiers, file contents, and quoted text, and yields to an explicit user request for another language. An absent preference adds no instruction and leaves existing model behavior unchanged.

## Alternatives considered

**Keep locale UI-only.** This preserves the old package boundary but cannot satisfy the user-visible expectation that selecting Chinese guides model output.

**Add a separate model-language setting.** A second preference can diverge from the language shown by the UI and creates another persistence and configuration surface without a separate product need.

**Rewrite user messages or post-process provider output.** Rewriting changes user-visible inputs or risks corrupting structured output; the system prompt is the existing model-facing extension point and keeps the original content intact.

## Consequences

The language preference applies to later model requests without restarting a session because the prompt text is read at assembly time. No preference means no added prompt tokens. The prompt is intentionally limited to natural-language response text, so executable and quoted material remains usable as written.

## Verification

The locale Host test assembles the system prompt with no preference, then verifies Chinese and English instructions after live settings updates. The locale package typecheck validates the settings scope and system-prompt integration.
