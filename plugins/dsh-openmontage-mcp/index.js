/**
 * OpenMontage guidance: a small host plugin that registers a system-prompt
 * section telling the model when to reach for the mcp__openmontage__* tools.
 *
 * The MCP client already exposes the tools with OpenMontage's own descriptions;
 * this section makes the "when to use OpenMontage" decision explicit and more
 * reliable so the model routes video-generation/recreation requests there.
 *
 * @module @dofe/dsh-openmontage-mcp
 */

export const name = 'openmontage-guidance'

/** The prompt registry this plugin contributes a section to. */
export const inject = ['systemPrompt']

/** Section order: right after the persona (order 0), before the tool sections. */
const ORDER = 5

const GUIDANCE = `OpenMontage 复杂视频生成：当用户需要脚本、分镜、多镜头、转场、拼接、成片编排，或上传源视频进行复刻、克隆、编辑，以及字幕、配音、音乐、口播等音画编排时，使用 mcp__openmontage__* 工具。仅生成 5–10 秒连续单镜头短视频（可带一张首帧图）时，使用 mcp__media__create_video_task，不要启动 OpenMontage 工作流。

执行顺序：
1. 先调用 mcp__openmontage__openmontage_capabilities，读取本次可用的 provider、工作流与提交契约；
2. 若用户给了视频地址，调用 mcp__openmontage__prepare_reference_clone，并按返回的 agent_instructions 走 OpenMontage 管线审批门。该调用会下载、转码、转写和场景分析，可能需要数分钟；如果客户端先返回超时，不要立即重复创建项目或判定失败，保留返回/日志中的 project_id，改用 mcp__openmontage__reference_clone_status 轮询到项目就绪；
3. 项目状态为 prepared 后，先调用 mcp__openmontage__list_project_files；需要读取 JSON/Markdown 分析内容时，直接调用 mcp__openmontage__read_project_file（通过已认证的 MCP 通道返回文本）。不要让远程客户端尝试 Read CI 主机的 /exchange/openmontage/<project_id>/... 路径；需要媒体或批量文件时，再调用 mcp__openmontage__sync_project_exports 或 mcp__openmontage__export_project_file；不要猜路径，也不要在 prepare 超时后直接读取交换目录；
4. 用 mcp__openmontage__submit_video_job 提交任务。所有字段必须作为工具的顶层参数直接传递，严禁包进 request、arguments 或 JSON 字符串：
   - workflow 必须是 pipeline 名（如 "animation"），绝不能是阶段名（compose 是 stage，不是 workflow）；
   - input 必须用 TEXT 分支：{"type":"text","inlineText":"<创意brief/概念文本>"}。绝不要用 ARTIFACT 分支 {"type":"artifact","artifactId":"<...>"} 去引用已准备的 project_id（如 clone-...）——project_id 不是 artifact，提交时会被拒绝（OPENMONTAGE_ARTIFACT_INPUT_FAILED）。artifactId 只用于真正经 artifact bridge 上传的文件；
   - 完整顶层参数示例：{"clientRequestId":"<幂等键>","workflow":"animation","input":{"type":"text","inlineText":"<创意brief>"},"brief":{"title":"<标题>","durationSeconds":60,"audience":"<受众>"},"output":{"container":"mp4","resolution":"1920x1080","fps":30},"budget":{"maxAmount":"100.00","currency":"CNY"}}。重试复用 clientRequestId，新任务更换。
5. 用 mcp__openmontage__get_video_job / list_video_job_events 跟踪任务进度；
6. 【人工审批 · 禁止自我审批】当 get_video_job 显示某阶段 status=WAITING_APPROVAL 时，严禁直接调用 approve_video_stage。必须：整理该阶段产物摘要（阶段名、产物清单、关键内容，如 proposal 的概念方案与报价 / script 的剧本 / publish 的成品链接），通过飞书审批卡片发给机器人，按钮 value 携带 job_id、stage、expected_sequence（=快照 lastSequence）；发完卡即结束本轮，等待真人在飞书点批准/拒绝；
7. 只有收到飞书回执（真人点击结果）后，才调用 mcp__openmontage__approve_video_stage 转达：approved 与真人点击严格一致（批准→true / 拒绝→false），expected_sequence 用回执带回的值，idempotency_key 用 {job_id}-{stage}-approval；
8. 被拒绝后向用户转达失败结果；cancel_video_job 仅用于用户明确要求取消；
9. 任务完成后用 mcp__openmontage__list_video_artifacts 取产物交付用户。

注意：OpenMontage 是视频专长工具，不要把它用于与视频无关的任务。

本地视频/本地文件作为参考源：只使用 OpenMontage MCP capabilities 返回的上传或导入流程，把工具返回的公开产物地址交给后续工具；不要猜测服务器路径、容器地址或内部端口。`

export function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'openmontage:guidance',
    order: ORDER,
    text: GUIDANCE,
  })
}
