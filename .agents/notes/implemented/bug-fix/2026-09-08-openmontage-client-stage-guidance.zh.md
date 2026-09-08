# Agent Note: OpenMontage 客户端工作流指引与循环控制

Status: implemented

[English](2026-09-08-openmontage-client-stage-guidance.md) | 中文

## Problem

OpenMontage 插件说明了视频 Job 的提交与跟踪方式，却遗漏了执行 selector 和成片编排工具所必需的客户端阶段生命周期。模型可能只携带逻辑工具操作和输入调用 `invoke_openmontage_tool`，导致服务端缺少 Job 与阶段 lease 上下文，最终只返回笼统的 MCP 执行失败。另一次参考视频复刻任务在桌面组合缺少完整指引的情况下暴露了数百个原生工具。项目准备完成后，模型反复声明需要 `read_project_file`，实际却发出项目列表或创建 Job 前的产物调用。以精确参数为键的提醒无法阻止不断改变无效 `job_id` 的调用。

## Decision

插件提示词明确规定 `submit_video_job` -> `begin_client_stage` -> 零次或多次该阶段允许的 `invoke_openmontage_tool` 调用 -> `submit_client_stage` 的完整顺序，并覆盖工具列表为空时不调用工具的情况。它把 begin 响应的 `jobId`、`stage`、`stageAttempt` 和 `leaseToken` 字段映射到后续工具的 `job_id`、`stage`、`stage_attempt` 和 `lease_token` 参数，并要求稳定的非空 `idempotency_key`。begin 响应的 `stageContract` 是本次执行的权威契约：模型逐个读取 `instructionFiles`，把每个结果映射为 `{path, content_hash}` 溯源项，只把 `gatewayTools` 中的精确名称传给调用工具，把 `declaredTools` 视为清单术语，并以 `produces` 作为提交产物的顶层键。

同一个 Host 插件负责 Agent 级工作流控制。参考项目准备成功，或参考项目状态返回 `prepared` 后，该 Agent 的全局 MCP 视图会收窄到参考项目检查、导出和 Job 提交工具，本地工具保持可用。Job 提交成功或收到新用户消息后，限制解除。插件还按 Agent、工具和规范化结果内容识别无进展结果。三个等价失败或三个内容不变的成功项目列表结果会打开熔断，使后续尝试在远程执行前被拒绝。参考项目和 Job 状态工具不参与熔断，因为轮询结果暂时不变可能属于正常情况。MCP bundle 把 URL 固定为公共网关，并通过 DSH credential service 解析 `MODELS_API_KEY`，不直接读取进程环境。

## Alternatives considered

**只依赖 OpenMontage 工具说明。** 不采用，因为宿主提示词会在具体调用前决定工具顺序，而缺失生命周期指引已经造成了不带上下文的 selector 调用。

**允许脱离 Job 调用 selector。** 不采用，因为 Job 归属、阶段授权、lease fencing、幂等、产物和费用审计都依赖现有客户端阶段生命周期。

**根据思考文本改写 provider 输出的工具名。** 不采用，因为思考文本不是类型化的意图通道，改写流式 provider 调用还会使持久化审计记录与 provider 输出不一致。工具投影无需臆测模型意图即可排除无效选项。

**让通用重复提醒直接阻止调用。** 不采用，因为其他领域可能需要内容不变的调用和状态轮询。阻止策略保留在 OpenMontage 插件内，按结果内容而非参数识别，并明确豁免轮询工具。

## Consequences

模型在选择 OpenMontage 工具前会同时收到明确的生命周期指令和服务端派生的逐阶段执行契约，服务端仍然负责最终 lease 校验。参考项目检查阶段呈现更少的 MCP 选项，即使参数变化，重复的等价失败也不会继续消耗远程调用。提示词和 Agent 级策略增加了插件状态与测试，但其他工具、其他 Agent 以及未挂载本插件的部署保持原有行为。

## Verification

根 Vitest 门禁执行插件测试，检查有序生命周期、camelCase 响应到 snake_case 参数的映射、精确的溯源对象构造、清单 `declaredTools` 与可调用 `gatewayTools` 的区别、禁止的无上下文参数集合，以及内部部署地址不会出现。同一测试通过真实工具注册表和 Agent scope 检查 prepared 阶段投影、Job 提交后恢复、变参失败识别、内容不变的项目列表、轮询豁免、Agent 隔离、用户消息重置、执行前拒绝和纠偏模型上下文。keyless 录制会话跟随当前 Session v2 writer，不错误声明历史迁移覆盖。
