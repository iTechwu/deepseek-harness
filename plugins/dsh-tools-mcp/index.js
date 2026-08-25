/**
 * tools.dofe.ai guidance: a small host plugin that registers a system-prompt
 * section telling the model when to reach for the mcp__tools-*__ tools.
 *
 * The nine mcp-client instances already expose the tools with tools.dofe.ai's own
 * descriptions. This section makes the "when to use tools.dofe.ai" decision
 * explicit and more reliable: it maps each business scenario to its domain
 * namespace (with representative entry tools, whose public names are the clean
 * snake_case names) and states the confirm/idempotency contract for writes.
 *
 * @module @dofe/dsh-tools-mcp
 */

export const name = 'tools-guidance'

/** The prompt registry this plugin contributes a section to. */
export const inject = ['systemPrompt']

/** Section order: right after the persona (order 0) and OpenMontage (order 5). */
const ORDER = 6

const GUIDANCE = `tools.dofe.ai 业务能力：当用户需要在 dofe.ai 内部业务域执行能力时，使用 mcp__tools-*__ 工具。工具按域划分命名空间，公共名均为 mcp__tools-<domain>__<snake_case>。先按场景选域：

- mcp__tools-platform__*：平台目录与通用运行。通用入口：mcp__tools-platform__business_capabilities_list / business_capability_get（能力发现）、text_summarize / summarizer（文本摘要）、platform_run_get / platform_run_cancel（任务运行）、platform_mutation_receipts_get（变更回执对账）。
- mcp__tools-supply-chain__*：供应链（供应商、关系、告警、风险事件、资讯情报）。读取：supply_chain_suppliers_list / supplier_get / relationships_list / alerts_list / risk_events_list / intelligence_report_get；写：supplier_create/update/archive/verify/import、alert_create/assign/resolve、relationship_review_submit、各类 run。
- mcp__tools-talent-discovery__*：人才发现（talent_discovery_discover、talent_candidates_list、talent_profiles_build、talent_outreach_drafts_build、talent_feedback_import、talent_metrics_*）。
- mcp__tools-lead-discovery__*：线索发现（lead_discovery_discover / batch_discover、lead_discovery_candidates_list、lead_discovery_status_get、lead_discovery_result_page_get、lead_discovery_llm_analysis_run、lead_discovery_manual_import）。
- mcp__tools-lead-monitor__*：线索监控（lead_monitor_run_start / run_get、lead_monitor_keywords_list / keyword_upsert、lead_monitor_sources_list / source_upsert、lead_monitor_results_list、lead_monitor_effectiveness_get）。
- mcp__tools-hotspot-discovery__*：热点发现（hotspot_discovery_plan_preview、hotspot_discovery_events_list、hotspot_discovery_run_start / run_get）。
- mcp__tools-custom-car-monitoring__*：定制车监控（custom_car_monitoring_run_start / run_get、custom_car_monitoring_assets_list、custom_car_monitoring_plan_get、custom_car_monitoring_browser_run_start、custom_car_monitoring_trends_list）。
- mcp__tools-viral-video__*：病毒视频（viral_video_discovery_run、viral_video_search、viral_video_candidates_list、viral_video_analysis_run / analysis_status_get、viral_video_storyboard_generate、viral_video_workflow_start / workflow_get）。
- mcp__tools-browser-intelligence__*：浏览器情报（browser_intelligence_plan_preview、browser_intelligence_run_start / run_get、browser_intelligence_evidence_list）。

使用约束：
1. 平台域总是先用于能力发现：mcp__tools-platform__business_capabilities_list 了解本次可用的能力与契约；
2. 带副作用的写入/命令工具需要 confirm=true，且必须提供非空 idempotencyKey（重复提交会返回幂等冲突）；
3. 同步变更响应丢失时，用 mcp__tools-platform__platform_mutation_receipts_get 凭原始 idempotencyKey 查询回执；indeterminate 回执必须通过对应域的读取/状态工具对账，绝不要自动重试或更换新 key；
4. 版本化资源更新按适用情况保留 expectedVersion 乐观并发；
5. 这些是不带认证的内部工具，仅用于内部环境，不要把它们当作外部公开能力。`

export function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'tools:guidance',
    order: ORDER,
    text: GUIDANCE,
  })
}
