/**
 * models-media guidance: a small host plugin that registers a system-prompt
 * section telling the model when to reach for the mcp__media__* tools and when
 * to prefer OpenMontage instead.
 *
 * 只提供选路规则、输入约束和轮询行为；不注入密钥或内部拓扑。工具的输入
 * Schema 是服务端能力的主边界，本提示只用于提升正确选路率。
 *
 * @module @dofe/dsh-models-media-mcp
 */

export const name = 'models-media-guidance'

/** The prompt registry this plugin contributes a section to. */
export const inject = ['systemPrompt']

/** Section order: after geoflow/geo (7)。 */
const ORDER = 8

const GUIDANCE = `媒体直连生成（mcp__media__*）：单张图片或 5–10 秒连续单镜头短视频的异步生成入口。

选路规则：
- 生成一张图片 → mcp__media__create_image_task（固定 seedream-5.0，单张输出）。
- 生成一个 5–10 秒连续单镜头视频（可带一张首帧图）→ mcp__media__create_video_task（固定 seedance-2.0-fast，无音频）。
- 脚本/分镜/多镜头/转场/拼接/成片、上传源视频复刻克隆或编辑、字幕/配音/音乐/音画编排 → 一律使用 OpenMontage（mcp__openmontage__*），不要用 media 工具硬凑。
- media 的 create 工具是严格对象输入：不接受 model、源视频、场景数组、字幕、音频等字段；误传会被服务端以 POLICY_REQUIRES_OPENMONTAGE 拒绝并提示改走 OpenMontage。

使用约束：
1. create 返回 taskId，不等待生成完成；用 mcp__media__get_generation_task 轮询——图片建议至少间隔 3 秒、视频至少 5 秒，连续无变化时退避到 10 秒。
2. create 的 idempotencyKey 必填（16–128 可打印 ASCII）：同一次用户意图的超时重试必须复用原键；用户明确要重新生成时才换新键。
3. 首帧 firstFrameUrl 只接受无用户名密码的公共 HTTPS 图片地址，不接受本地路径或 data: URL。
4. 成功结果是 Models 托管的 HTTPS 产物 URL 和元数据（宽高/时长/大小/费用）；URL 失效后重新调用 get_generation_task 获取新地址，不要尝试让远端写本地文件。
5. 取消用 mcp__media__cancel_generation_task；已成功/失败/取消的任务返回幂等终态。`

export function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'models-media:guidance',
    order: ORDER,
    text: GUIDANCE,
  })
}
