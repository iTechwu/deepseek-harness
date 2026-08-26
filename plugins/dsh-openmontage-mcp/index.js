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
3. 用 mcp__openmontage__submit_video_job 提交任务，request 必须满足：
   - request.workflow 必须是 pipeline 名（如 "animation"），绝不能是阶段名（compose 是 stage，不是 workflow）；
   - request.input 必须用 TEXT 分支：{"type":"text","inlineText":"<创意brief/概念文本>"}。绝不要用 ARTIFACT 分支 {"type":"artifact","artifactId":"<...>"} 去引用已准备的 project_id（如 clone-...）——project_id 不是 artifact，提交时会被拒绝（OPENMONTAGE_ARTIFACT_INPUT_FAILED）。artifactId 只用于真正经 artifact bridge 上传的文件；
   - 其余按契约：brief/{title,durationSeconds,audience}、output/{container,resolution,fps}、budget/{maxAmount,currency}、clientRequestId（幂等键，重试复用、新任务更换）。
4. 用 mcp__openmontage__get_video_job / list_video_job_events / approve_video_stage / cancel_video_job 跟踪、审批与取消；
5. 完成后用 mcp__openmontage__list_video_artifacts 获取产物，并把结果（视频/素材）交付给用户。

注意：OpenMontage 是视频专长工具，不要把它用于与视频无关的任务。

本地视频/本地文件作为参考源：
- prepare_reference_clone 的 source 必须是 OpenMontage 容器能够 fetch 的 http(s) URL（本地文件路径会被拒）。
- 用共享交换目录 + 静态 file-server 提供，最稳：把本地视频拷贝到当前容器的 /exchange/ 下（这是宿主 /data/mcp-exchange 的挂载），然后 source 用
  http://host.docker.internal:18090/<相对路径>
  （file-server 已把 /data/mcp-exchange 以 HTTP 暴露，OpenMontage 通过 host.docker.internal 取；当前已开启 OPENMONTAGE_ALLOW_PRIVATE_URLS，该内网 URL 会被接受）。
- 示例：cp "/home/node/测试视频/xxx.mp4" /exchange/ref.mp4，然后 source=http://host.docker.internal:18090/ref.mp4。
- 不要用 127.0.0.1：OpenMontage 与 harness 处于不同网络命名空间，127.0.0.1 指向 OpenMontage 自己。
- OpenMontage 的产物（生成视频/素材）通过 artifact bridge 暴露，运行时可用 http://127.0.0.1:1455/<artifact> 或 list_video_artifacts 返回的地址访问。`

export function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'openmontage:guidance',
    order: ORDER,
    text: GUIDANCE,
  })
}
