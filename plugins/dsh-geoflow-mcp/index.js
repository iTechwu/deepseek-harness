/**
 * geoflow guidance: a small host plugin that registers a system-prompt section
 * telling the model when to reach for the mcp__geoflow__* tools.
 *
 * The geoflow mcp-client instance already exposes the tools with geoflow's own
 * descriptions. This section makes the "when to use geoflow (geo.dofe.ai)"
 * decision explicit and more reliable by mapping each scenario to its MCP tool
 * group, and states the confirmation/idempotency contract for writes.
 *
 * Naming note: geoflow's own tool names already carry a `geoflow.` project
 * prefix (e.g. `geoflow.tasks.list`). The DSH mcp-client sanitizes `.` -> `_`
 * and appends a short hash on lossy normalization, so the model-facing public
 * names look like `mcp__geoflow__geoflow_<group>_<action>_<hash>` (note the
 * doubled `geoflow`). The model should discover the exact names from the tool
 * catalog rather than hard-coding them.
 *
 * @module @dofe/dsh-geoflow-mcp
 */

export const name = 'geoflow-guidance'

/** The prompt registry this plugin contributes a section to. */
export const inject = ['systemPrompt']

/** Section order: right after the persona (order 0), OpenMontage (5) and tools (6). */
const ORDER = 7

const GUIDANCE = `geoflow（geo.dofe.ai）站点与内容：当用户需要操作 geo.dofe.ai 的内容/文章、素材/目录、线索、站点、分发、企业知识库、分析、URL 导入或系统运维时，使用 mcp__geoflow__* 工具。

工具分组（公共名形如 mcp__geoflow__geoflow_<group>_<action>，因原工具名带 geoflow. 前缀，公共名会重复一次并可能带短哈希后缀；请以模型侧工具目录里的真实名称为准）：
- 发现：mcp__geoflow__geoflow_catalog / geoflow_capabilities（读目录/能力与租户作用域，先用于了解环境）、geoflow_system_status（部署诊断）。
- 任务生成：mcp__geoflow__geoflow_tasks_*（list/create/get/start/stop/enqueue/update/delete/jobs）、geoflow_jobs_get/_cancel。
- 内容：mcp__geoflow__geoflow_articles_*（list/get/create/update/review/publish/trash）。
- 素材/目录：mcp__geoflow__geoflow_materials_*（summary/list/get/items.list/create/update/delete/items.create/items.delete）。
- URL 导入：mcp__geoflow__geoflow_url_import_*（create/run/status/commit）。
- 企业知识库：mcp__geoflow__geoflow_enterprise_knowledge_*（list/create/status/validate/autosave/publish/delete）。
- 站点前台：mcp__geoflow__geoflow_site_search / site_article / site_archive / site_capabilities。
- 分发：mcp__geoflow__geoflow_distribution_channels / jobs / health。
- 线索：mcp__geoflow__geoflow_leads_forms / submissions / get / update_status。
- 分析：mcp__geoflow__geoflow_analytics_overview。

使用约束：
1. 先调用 mcp__geoflow__geoflow_capabilities（或 catalog）确认可用对象模型与租户作用域；
2. 默认令牌为系统级（跨租户，tenantId 为 null），用于 CI/运维引导；如需指定租户，按工具参数传入；
3. 带副作用写入需提供 idempotency_key（同 key 重试返回缓存结果，勿重复提交）；破坏性操作需显式 confirmation（如 IMPORT / PUBLISH / DELETE）；
4. 该端点在内部网络经 Bearer 令牌鉴权，仅用于内部环境。`

export function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'geoflow:guidance',
    order: ORDER,
    text: GUIDANCE,
  })
}
