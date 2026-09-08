# Agent Note: OpenMontage 客户端阶段指引

Status: implemented

[English](2026-09-08-openmontage-client-stage-guidance.md) | 中文

## Problem

OpenMontage 插件说明了视频 Job 的提交与跟踪方式，却遗漏了执行 selector 和成片编排工具所必需的客户端阶段生命周期。模型可能只携带逻辑工具操作和输入调用 `invoke_openmontage_tool`，导致服务端缺少 Job 与阶段 lease 上下文，最终只返回笼统的 MCP 执行失败。

## Decision

插件提示词明确规定 `submit_video_job` -> `begin_client_stage` -> 零次或多次该阶段允许的 `invoke_openmontage_tool` 调用 -> `submit_client_stage` 的完整顺序，并覆盖工具列表为空时不调用工具的情况。它把 begin 响应的 `jobId`、`stage`、`stageAttempt` 和 `leaseToken` 字段映射到后续工具的 `job_id`、`stage`、`stage_attempt` 和 `lease_token` 参数，并要求稳定的非空 `idempotency_key`。begin 响应的 `stageContract` 是本次执行的权威契约：模型逐个读取 `instructionFiles`，把每个结果映射为 `{path, content_hash}` 溯源项，只把 `gatewayTools` 中的精确名称传给调用工具，把 `declaredTools` 视为清单术语，并以 `produces` 作为提交产物的顶层键。MCP bundle 把 URL 固定为公共网关，并通过 DSH credential service 解析 `MODELS_API_KEY`，不再直接读取进程环境。包 README 记录相同的调用方义务，插件回归测试进入根 Vitest 测试清单。

## Alternatives considered

**只依赖 OpenMontage 工具说明。** 不采用，因为宿主提示词会在具体调用前决定工具顺序，而缺失生命周期指引已经造成了不带上下文的 selector 调用。

**允许脱离 Job 调用 selector。** 不采用，因为 Job 归属、阶段授权、lease fencing、幂等、产物和费用审计都依赖现有客户端阶段生命周期。

## Consequences

模型在选择 OpenMontage 工具前会同时收到明确的生命周期指令和服务端派生的逐阶段执行契约，服务端仍然负责最终 lease 校验。提示词有所增长，但能阻止在缺少 Job 和阶段上下文时尝试计费或有状态操作。

## Verification

根 Vitest 门禁执行插件测试，检查有序生命周期、camelCase 响应到 snake_case 参数的映射、精确的溯源对象构造、清单 `declaredTools` 与可调用 `gatewayTools` 的区别、禁止的无上下文参数集合，以及内部部署地址不会出现。keyless 录制会话跟随当前 Session v2 writer，不再错误声明历史迁移覆盖。
