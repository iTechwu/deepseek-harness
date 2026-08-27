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
4. 用 mcp__openmontage__get_video_job / list_video_job_events 跟踪任务进度；
5. 【人工审批 · 禁止自我审批】当 get_video_job 显示某阶段 status=WAITING_APPROVAL 时，严禁直接调用 approve_video_stage。必须：整理该阶段产物摘要（阶段名、产物清单、关键内容，如 proposal 的概念方案与报价 / script 的剧本 / publish 的成品链接），通过飞书审批卡片发给机器人，按钮 value 携带 job_id、stage、expected_sequence（=快照 lastSequence）；发完卡即结束本轮，等待真人在飞书点批准/拒绝；
6. 只有收到飞书回执（真人点击结果）后，才调用 mcp__openmontage__approve_video_stage 转达：approved 与真人点击严格一致（批准→true / 拒绝→false），expected_sequence 用回执带回的值，idempotency_key 用 {job_id}-{stage}-approval；
7. 被拒绝后向用户转达失败结果；cancel_video_job 仅用于用户明确要求取消；
8. 任务完成后用 mcp__openmontage__list_video_artifacts 取产物交付用户。

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
