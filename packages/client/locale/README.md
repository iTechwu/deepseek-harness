# @deepseek-ai/dsh-client-locale

English | [中文](README.zh.md)

Locale plugin: LocaleRuntime — the `zh`/`en` preference stored as `locale.preference` in `$DSH_HOME/settings.yaml`; when that explicit Host value is absent, a fresh browser starts provisionally in the language `navigator` asks for (primary-subtag matching, with `en` when it asks for no language this app ships). The Host read runs after plugin activation so an unavailable settings service cannot block the page; its result replaces the provisional browser value live. Remote browsers retain only a process-local selection because the settings API is loopback-only. `locale/change` fires on switches, and the plugin points `<html lang>` at the active locale (`zh-CN`/`en`) on activation and on every switch. The service also owns the ns×locale dictionary registry (typed `register(ns, {zh, en})` checked against `LocaleNamespaceMap`, `bind(ns)`→`TranslateNS<ns>`; lookup chain ns → common → en → key), implements the slot system's `LocaleFace`, and installs itself through `ctx.slots.installLocale`, backing the framework-injected `t` standard seat (`Translate`/`TranslateNS` are ui-slots types; import them from there — this package only re-exports for dictionary owners' convenience). The [Host-backed preferences decision](../../../.agents/notes/implemented/bug-fix/2026-08-06-host-backed-web-preferences.md) owns the persistence boundary.

## Model Experience

### Response-language system prompt

#### What the model sees

When `locale.preference` is explicitly set, the Host half adds a live `preference:response-language` section: `zh` requests Chinese and `en` requests English for model-facing natural-language content. The instruction preserves code, commands, paths, identifiers, file contents, and quoted text, and an explicit user request for another language takes precedence. When the preference is absent, this package adds no language instruction.

##### Prompt text

```markdown
请始终使用中文回答用户。解释、总结、状态更新和其他面向用户的自然语言内容使用中文。代码、命令、路径、标识符、文件内容和引用文本保持原样；除非用户明确要求其他语言，否则不要切换语言。
```

#### Token effect

The section adds one short instruction only when an explicit preference exists; no preference adds no prompt tokens.

#### KV Cache effect

The section is assembled with the system prompt for each model request, so changing the setting applies to later requests without restarting the session. The text is deterministic for a given preference and changes the system-prompt cache key only when the preference changes.

## Known Limitations and Deferred Work

- **Some surfaces keep inline copy** — Settings rows, the sidebar, question composer, and model select use locale seats; other packages still own static text directly.
- **Registry-held text reads its translation once** — copy captured at registration time outside the slot render path (e.g. the `/model` command description in the command registry) keeps the language it was registered under until re-registration; slot-rendered copy follows switches live.
