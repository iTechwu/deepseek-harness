# @deepseek-ai/dsh-tool-ci

[English](README.md) | 中文

模型可用的 CI 质量门禁工具 - `ci_run` - 构建在 [shell 能力缝](../../shell/shell/README.zh.md)（`ctx.shell`）之上。本包只负责模型可见的职责：工具名、JSON schema、snake_case 参数、prompt 段落、逐门禁校验、输出裁剪投影，以及 terminal 展示卡片。每个门禁都经 `ctx.shell` 执行，因此沙箱、超时与取消均由 shell 执行器负责。

`ci_run` 在目标目录按顺序运行一个或多个 CI 质量门禁命令（例如 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`），并返回一个结构化结果值：总体判定 + 每个门禁的记录（包含退出码、结束信号、超时与中止事实、耗时、以及裁剪后的 stdout/stderr 尾部）。默认在首个失败门禁处停止（`stopOnFailure: true`），让模型看到第一个失败，而不是一串无关失败。

## 工具

| 工具 | 参数 | 行为 |
|---|---|---|
| `ci_run` | `cwd`（string，必填）；`gates`（string[]，必填）；`stopOnFailure`（boolean，可选） | 在 `cwd` 中按顺序运行门禁命令，每个门禁捕获有界输出尾部，并返回结构化的 `{ cwd, overall, gates[] }` 值。`overall` 为 `passed`、`failed` 或 `aborted`。 |

`gates` 接受 shell 命令字符串（例如 `pnpm lint`），而不是裸脚本名，从而由模型控制具体调用方式，而工具负责结构化判定与停止策略。

## 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `timeoutMs` | `120000` | 每个门禁的协作超时预算（ms），附为 `ToolDefinition.timeoutMs`。 |
| `maxOutputChars` | `20000` | 每个门禁保留在规范值中的 stdout/stderr 字符上限。 |
| `stopOnFailure` | `true` | 当模型未指定时的 `stopOnFailure` 默认值。 |

```yaml
- id: tool-ci
  name: @deepseek-ai/dsh-tool-ci
```

## 模型体验

### 系统提示

`ci_run` 工具注册 `tool:ci_run` prompt 段落，提示模型在需要单一结构化判定时优先用它对多个门禁做 CI 检查。

### 输出

规范值即编程接口；Native 渲染器将其整理为 markdown 摘要（`CI gate run in <cwd>`、总体判定、再每个门禁一个 `## <command>` 块，含状态、原因、耗时与裁剪后的输出尾部）。

## 稳定注册

工具注册遵循启用即注册，而非依赖后端可用性：无法运行的门禁被报告为结构化值中的 failed 门禁，而不是抛出一个基础设施错误，从而在不同 provider/executor 变化下保持模型 schema 稳定。

## 已知限制

- 必须挂载 `ctx.shell`（bash/pwsh 执行器提供它）；没有它的组合无法加载本工具。
- 本工具不管理长时间运行的后台门禁批次；每次 `ci_run` 调用都是带界的前台序列。
- `maxOutputChars` 裁剪的是规范值，而非执行器自身的捕获；当发生截断时，完整流仍可通过底层 `CollectedOutput` spill 路径恢复。
