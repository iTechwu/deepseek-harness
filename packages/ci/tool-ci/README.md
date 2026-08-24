# @deepseek-ai/dsh-tool-ci

English | [中文](README.zh.md)

The model-facing CI quality-gate tool - `ci_run` - over the [shell capability seam](../../shell/shell/README.md) (`ctx.shell`). The package owns model-facing concerns only: the tool name, JSON schema, snake_case arguments, prompt section, per-gate validation, bounded output projection, and the terminal presentation card. Every gate runs through `ctx.shell`, so sandboxing, timeouts, and cancellation stay the shell executor responsibility.

`ci_run` runs one or more CI quality-gate commands in sequence in a target directory (for example `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`) and returns one structured result value: an overall verdict plus a per-gate record carrying exit code, terminating signal, timeout and abort facts, duration, and the bounded stdout/stderr tail. A failed gate stops the sequence by default (`stopOnFailure: true`) so the model sees the first failing gate rather than a cascade of unrelated failures.

## Tool

| Tool | Args | Behavior |
|---|---|---|
| `ci_run` | `cwd` (string, required); `gates` (string[], required); `stopOnFailure` (boolean, optional) | Runs the gate commands in order in `cwd`, captures a bounded output tail per gate, and returns a structured `{ cwd, overall, gates[] }` value. `overall` is `passed`, `failed`, or `aborted`. |

The `gates` array accepts shell command strings (for example `pnpm lint`) rather than raw script names, so the model controls the exact invocation while the tool supplies the structured verdicts and the stopping policy.

## Config

| Key | Default | Meaning |
|---|---|---|
| `timeoutMs` | `120000` | Per-gate cooperative timeout budget (ms), attached as `ToolDefinition.timeoutMs`. |
| `maxOutputChars` | `20000` | Cap on characters of each gate captured stdout/stderr kept in the canonical value. |
| `stopOnFailure` | `true` | Default for `stopOnFailure` when the model omits it. |

```yaml
- id: tool-ci
  name: @deepseek-ai/dsh-tool-ci
```

## Model Experience

### System prompt

The `ci_run` tool registers a `tool:ci_run` prompt section telling the model to prefer it for multi-gate CI checks when it wants a single structured verdict.

### Output

The canonical value is the programmatic API. The Native renderer folds it into a markdown summary (`CI gate run in <cwd>`, the overall verdict, then one `## <command>` block per gate with its status, reason, duration, and bounded output tail).

## Stable registration

Tool registration follows enablement, not backend availability: a gate that fails to run is reported as a failed gate in the structured value rather than thrown as an infrastructure error, so the model schema stays stable across provider and executor changes.

## Known Limitations

- `ctx.shell` must be mounted (the bash/pwsh executors supply it); a composition without it cannot load the tool.
- The tool does not manage long-running background gate batches; each `ci_run` call is a bounded foreground sequence.
- `maxOutputChars` caps the canonical value, not the executor own capture; a full stream is still recoverable through the underlying `CollectedOutput` spill path when truncation occurs.
