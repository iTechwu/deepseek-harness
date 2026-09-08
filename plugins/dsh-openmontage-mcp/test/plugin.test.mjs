import { readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'
import { apply } from '../index.js'

const patchUrl = new URL('../cordis.patch.yml', import.meta.url)

test('registers only the public gateway through the credential service', async () => {
  const patch = await readFile(patchUrl, 'utf8')

  expect(patch).toMatch(/url: 'https:\/\/ixicai\.cn\/mcp\/montage'/)
  expect(patch).toMatch(/authorizationCredential: MODELS_API_KEY/)
  expect(patch).toMatch(/missing MODELS_API_KEY fails before the client connects/)
  expect(patch).not.toMatch(/process\.env\.MODELS_API_KEY|headers:\s*\n\s*Authorization:/)
  expect(patch).not.toMatch(/172\.30\.30\.11|127\.0\.0\.1|localhost|host\.docker\.internal|:8765/)
})

test('guidance carries the complete client-stage lifecycle', () => {
  let section
  apply({
    systemPrompt: {
      section(value) {
        section = value
      },
    },
  })

  expect(section.name).toBe('openmontage:guidance')
  expect(section.text).toMatch(/submit_video_job → begin_client_stage →（按 stageContract\.gatewayTools 调用零次或多次 invoke_openmontage_tool）/)
  expect(section.text).toMatch(/stageContract 为本次执行的权威契约/)
  expect(section.text).toMatch(/jobId、stage、stageAttempt、leaseToken 和 stageContract/)
  expect(section.text).toMatch(/job_id=jobId、stage=stage、stage_attempt=stageAttempt、lease_token=leaseToken/)
  expect(section.text).toMatch(/instructionFiles/)
  expect(section.text).toMatch(/{"path": result\.relative_path, "content_hash": result\.content_hash}/)
  expect(section.text).toMatch(/组成 submit 的 instruction_provenance/)
  expect(section.text).toMatch(/declaredTools 只是 pipeline manifest 的原始术语/)
  expect(section.text).toMatch(/只能把 gatewayTools 中的精确工具名传给 invoke_openmontage_tool/)
  expect(section.text).toMatch(/artifacts 必须以 produces 中的标准产物名为顶层 key/)
  expect(section.text).toMatch(/不能只传 tool_name、operation、inputs/)
  expect(section.text).toMatch(/{"research_brief": {"version":"1.0", \.\.\.}}/)
  expect(section.text).toMatch(/不能把 version、topic 等 brief 字段直接放在 artifacts 顶层/)
  expect(section.text).not.toMatch(/172\.30\.30\.11|127\.0\.0\.1|localhost|:8765/)
})
