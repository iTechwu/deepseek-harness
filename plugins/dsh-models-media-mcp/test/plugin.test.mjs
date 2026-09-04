import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { apply } from '../index.js'

const patchUrl = new URL('../cordis.patch.yml', import.meta.url)
const montageGuidanceUrl = new URL('../../dsh-openmontage-mcp/index.js', import.meta.url)

test('registers only the fixed public media MCP endpoint', async () => {
  const patch = await readFile(patchUrl, 'utf8')
  assert.match(patch, /url: 'https:\/\/ixicai\.cn\/mcp\/media'/)
  assert.match(patch, /authorizationCredential: MODELS_API_KEY/)
  assert.doesNotMatch(patch, /process\.env\.MODELS_API_KEY/)
  assert.doesNotMatch(patch, /MCP_BASE_URL|MEDIA_MCP_URL|MEDIA_BASE_URL/)
  assert.doesNotMatch(patch, /172\.30\.30\.11|127\.0\.0\.1|localhost/)
})

test('guidance preserves the direct-media and OpenMontage boundary', () => {
  let section
  apply({
    systemPrompt: {
      section(value) {
        section = value
      },
    },
  })

  assert.equal(section.name, 'models-media:guidance')
  assert.match(section.text, /mcp__media__create_image_task/)
  assert.match(section.text, /mcp__media__create_video_task/)
  assert.match(section.text, /mcp__openmontage__/)
  assert.match(section.text, /idempotencyKey/)
  assert.match(section.text, /get_generation_task/)
})

test('OpenMontage guidance owns only complex video and exposes no internal topology', async () => {
  const source = await readFile(montageGuidanceUrl, 'utf8')
  assert.match(source, /mcp__media__create_video_task/)
  assert.match(source, /脚本、分镜、多镜头/)
  assert.doesNotMatch(source, /127\.0\.0\.1|host\.docker\.internal|OPENMONTAGE_ALLOW_PRIVATE_URLS/)
})
