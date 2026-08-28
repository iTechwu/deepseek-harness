export const name = 'geo-mcp-guidance'
export const inject = ['systemPrompt']

export function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'geo:mcp-guidance',
    order: 7,
    text: 'GEO 工作流同时使用 mcp__geoflow__* 与 mcp__georank__*。先调用各自的能力发现工具，再执行读取或写入；写入必须确认并使用稳定幂等键。GeoFlow 负责站点、内容、素材、线索和分发，GEORank 负责 GEO 诊断、拓词、问答和结构化内容。以工具目录中的实际名称为准，不要猜测名称或伪造异步结果。',
  })
}
