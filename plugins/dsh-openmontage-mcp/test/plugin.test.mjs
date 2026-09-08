import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../index.js'

test('guidance carries the complete client-stage lifecycle', () => {
  let section
  apply({
    systemPrompt: {
      section(value) {
        section = value
      },
    },
  })

  assert.equal(section.name, 'openmontage:guidance')
  assert.match(section.text, /submit_video_job → begin_client_stage →（按 tools_available 调用零次或多次 invoke_openmontage_tool）/)
  assert.match(section.text, /tools_available 为空时不要虚构调用/)
  assert.match(section.text, /jobId、stage、stageAttempt 和 leaseToken/)
  assert.match(section.text, /job_id=jobId、stage=stage、stage_attempt=stageAttempt、lease_token=leaseToken/)
  assert.match(section.text, /非空稳定 idempotency_key/)
  assert.match(section.text, /不能只传 tool_name、operation、inputs/)
  assert.match(section.text, /{"research_brief": {"version":"1.0", \.\.\.}}/)
  assert.match(section.text, /不能把 version、topic 等 brief 字段直接放在 artifacts 顶层/)
  assert.doesNotMatch(section.text, /172\.30\.30\.11|127\.0\.0\.1|localhost|:8765/)
})
