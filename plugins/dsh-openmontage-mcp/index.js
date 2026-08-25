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

const GUIDANCE = `OpenMontage 视频生成：当用户需要生成、复刻或克隆视频，尤其提供了视频 URL（含抖音/短视频链接）时，使用 mcp__openmontage__* 工具。

执行顺序：
1. 先调用 mcp__openmontage__openmontage_capabilities，读取本次可用的 provider、工作流与提交契约；
2. 若用户给了视频地址，调用 mcp__openmontage__prepare_reference_clone，并按返回的 agent_instructions 走 OpenMontage 管线审批门；
3. 用 mcp__openmontage__submit_video_job 提交任务（request.workflow 必须是 pipeline 名，例如 compose，而不是阶段名）；
4. 用 mcp__openmontage__get_video_job / list_video_job_events / approve_video_stage / cancel_video_job 跟踪、审批与取消；
5. 完成后用 mcp__openmontage__list_video_artifacts 获取产物，并把结果（视频/素材）交付给用户。

注意：OpenMontage 是视频专长工具，不要把它用于与视频无关的任务。`

export function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'openmontage:guidance',
    order: ORDER,
    text: GUIDANCE,
  })
}
