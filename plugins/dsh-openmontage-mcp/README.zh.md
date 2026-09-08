# dsh-openmontage-mcp

[English](README.md) | 中文

这是一个 DeepSeek Harness（DSH）**组合包**，用于在 `web` profile 中注册 OpenMontage MCP 服务作为额外的 MCP 客户端，并添加系统提示词，告诉模型何时使用该服务。

## 暴露内容

- OpenMontage MCP 工具以 DSH 服务限定命名空间 `mcp__openmontage__<tool>` 注册为原生工具，例如 `mcp__openmontage__submit_video_job`。
- 提示词段落（`openmontage:guidance`）指示模型对脚本化、多镜头、编辑或克隆重制任务依次调用 `mcp__openmontage__openmontage_capabilities` → `prepare_reference_clone` → `submit_video_job`。持续 5–10 秒的连续单镜头短片应改用 Media MCP。

`prepare_reference_clone` 是一项同步的长时间操作，因为它可能下载源视频并运行 ffmpeg／转写分析。组合包为该调用提供最长 10 分钟。如果客户端报告超时，请保留返回的 `project_id`，并在重试前调用 `mcp__openmontage__reference_clone_status`；重试会复用已完成的项目。状态变为 `prepared` 后，调用 `list_project_files`。对于 JSON／Markdown 分析文件，使用 `read_project_file`，让远程客户端通过已认证的 MCP 通道接收文本；不要把仅 CI 可用的 `/exchange/openmontage/<project_id>` 路径传给本地 `Read` 工具。只有在需要共享挂载或交付媒体时，才使用 `sync_project_exports` 或 `export_project_file`。

调用 `submit_video_job` 后，按 `begin_client_stage` -> 零次或多次该阶段允许的 `invoke_openmontage_tool` 调用 -> `submit_client_stage` 驱动每个客户端负责的阶段。阶段工具列表为空时，不要虚构调用。`begin_client_stage` 返回 `jobId`、`stage`、`stageAttempt`、`leaseToken` 和 `stageContract`；把 lease 字段映射到顶层参数 `job_id`、`stage`、`stage_attempt` 和 `lease_token`。每次非 catalog 调用还必须提供稳定的非空 `idempotency_key`。Selector、preflight、ranking、generation、progress 和 composition 调用不是独立的 provider API。

把 `stageContract` 视为该次执行的权威约定：通过 `read_openmontage_file` 读取每个 `instructionFiles` 项，并把每个返回结果映射为 `instruction_provenance`：`{"path": result.relative_path, "content_hash": result.content_hash}`。`declaredTools` 包含 pipeline manifest（流水线元数据清单）中的原始词汇；只把 `gatewayTools` 中的精确名称传给 `invoke_openmontage_tool`。使用 `produces` 作为提交的 `artifacts` 顶层键。例如传入 `{"research_brief": {<brief fields>}}`，不要把 brief 字段直接放在 `artifacts` 顶层。

## 凭据

| 凭据名称 | 含义 | 默认值 |
|---|---|---|
| `MODELS_API_KEY` | 由 DSH 凭据服务解析并发送给网关的唯一 Models API key | *（必填）* |

MCP 端点固定为 `https://ixicai.cn/mcp/montage`；用户不能配置仅 CI 可用的 base URL。

MCP 客户端在连接前要求提供 `MODELS_API_KEY`，网关会在每个请求中验证该凭据。DSH 不配置 OpenMontage 服务 token 或 job attribution。

`failOnStartupError` 为 `false`：如果 OpenMontage 暂时不可用，web profile 仍可启动；服务恢复后，重连 supervisor 会注册工具。

## 安装

通过部署的插件挂载和 `DSH_PLUGIN_SPECS` 交付：

```sh
# in docker-helm.dofe.ai .env
DEEPSEEK_HARNESS_PLUGIN_SOURCE_DIR=../deepseek-harness/plugins
DSH_PLUGIN_SPECS=/opt/dsh-plugins/dsh-openmontage-mcp
```

也可以从 checkout 安装：

```sh
dsh plugin --profile web add ./dsh-openmontage-mcp
```
