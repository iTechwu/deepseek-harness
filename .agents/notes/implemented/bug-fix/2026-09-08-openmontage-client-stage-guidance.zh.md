# Agent Note: OpenMontage 客户端阶段指引

Status: implemented

[English](2026-09-08-openmontage-client-stage-guidance.md) | 中文

## Problem

OpenMontage 插件说明了视频 Job 的提交与跟踪方式，却遗漏了执行 selector 和成片编排工具所必需的客户端阶段生命周期。模型可能只携带逻辑工具操作和输入调用 `invoke_openmontage_tool`，导致服务端缺少 Job 与阶段 lease 上下文，最终只返回笼统的 MCP 执行失败。

## Decision

插件提示词明确规定 `submit_video_job` -> `begin_client_stage` -> 零次或多次该阶段允许的 `invoke_openmontage_tool` 调用 -> `submit_client_stage` 的完整顺序，并覆盖工具列表为空时不调用工具的情况。它把 begin 响应的 `jobId`、`stage`、`stageAttempt` 和 `leaseToken` 字段映射到后续工具的 `job_id`、`stage`、`stage_attempt` 和 `lease_token` 参数，并要求稳定的非空 `idempotency_key`。它还要求阶段产物包装在 `research_brief` 等标准产物名下，不能把产物字段直接放在 `artifacts` 对象中。包 README 记录相同的调用方义务，归属插件的本地测试负责锁定提示词中的必需术语。

## Alternatives considered

**只依赖 OpenMontage 工具说明。** 不采用，因为宿主提示词会在具体调用前决定工具顺序，而缺失生命周期指引已经造成了不带上下文的 selector 调用。

**允许脱离 Job 调用 selector。** 不采用，因为 Job 归属、阶段授权、lease fencing、幂等、产物和费用审计都依赖现有客户端阶段生命周期。

## Consequences

模型在选择 OpenMontage 工具前会收到明确的生命周期指令，服务端仍然负责最终 lease 校验。提示词有所增长，但能阻止在缺少 Job 和阶段上下文时尝试计费或有状态操作。

## Verification

插件归属的本地测试检查有序生命周期、camelCase 响应到 snake_case 参数的映射、标准产物包装、禁止的无上下文参数集合，以及内部部署地址不会出现。
