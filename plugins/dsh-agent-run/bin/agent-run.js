#!/usr/bin/env node
/**
 * dsh-agent-run — headless OpenMontage pipeline-stage executor.
 *
 * Replaces `codex exec`. When OpenMontage's `AgentCommandPipelineExecutor` runs
 * a stage it spawns the argv array from `OPENMONTAGE_AGENT_EXECUTOR_JSON`, feeds
 * the stage prompt on stdin, and injects the LLM gateway route on the process
 * environment. This bin is that argv element.
 *
 * Protocol (OpenMontage/openmontage/pipeline_executor.py):
 *   - argv:  `["node", "<this file>"]` (the {project_dir} placeholder is already
 *            substituted to the assignment's project dir by the executor).
 *   - stdin: `_stage_prompt` — the FIRST line is
 *            OPENMONTAGE_ASSIGNMENT_PATH="<path>", where <path> is the
 *            `StageAssignment.to_wire()` JSON file (executor.py:658-679); the
 *            remaining stdin is the human/agent prompt.
 *   - env:   OPENAI_API_KEY / OPENAI_BASE_URL / DOFE_MODEL_API_KEY /
 *            DOFE_MODEL_BASE_URL identify the OpenAI-compatible gateway route
 *            the LLM must use (executor.py:277-286).
 *   - cwd:   the OpenMontage checkout (executor.py:452 `cwd=ROOT`), so
 *            `python -c 'from lib.checkpoint import ...'` and `from tools...`
 *            resolve.
 *
 * The bin drives ONE agent turn through the DeepSeek Harness spine (this
 * plugin's cordis.yml) with the bash tool, then writes the stage checkpoint
 * through OpenMontage's `lib.checkpoint.write_checkpoint` — the same Python
 * entry point OpenMontage itself uses — so the worker sees the finished stage.
 *
 * @module @dofe/dsh-agent-run/bin
 */

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { boot, installFailLoud, loadEnv } from '@deepseek-ai/dsh-app-boot'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

const NAME = 'dsh-agent-run'
const HERE = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = join(HERE, '..', 'cordis.yml')
const RESULT_REL = join('.openmontage', 'agent-run', 'result.json')

/** Read all of stdin as UTF-8 text. */
function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = []
    process.stdin.on('data', (chunk) => chunks.push(chunk))
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    process.stdin.on('error', reject)
  })
}

/**
 * Extract the assignment file path from the first stdin line.
 * `_stage_prompt` emits `OPENMONTAGE_ASSIGNMENT_PATH="<path>"` (json.dumps),
 * but a bare path is accepted too for robustness.
 */
function parseAssignmentPath(firstLine) {
  const line = firstLine.trim()
  if (!line) {
    throw new Error('dsh-agent-run: empty first stdin line; expected OPENMONTAGE_ASSIGNMENT_PATH=...')
  }
  if (line.startsWith('OPENMONTAGE_ASSIGNMENT_PATH=')) {
    const raw = line.slice('OPENMONTAGE_ASSIGNMENT_PATH='.length).trim()
    if (raw.startsWith('"')) {
      try { return JSON.parse(raw) } catch { return raw.replace(/^"|"$/g, '') }
    }
    if (raw.startsWith("'")) return raw.replace(/^'|'$/g, '')
    return raw
  }
  // Bare path (or already-unquoted).
  return line.replace(/^"|"$/g, '').replace(/^'|'$/g, '')
}

/** Resolve the OpenMontage Python interpreter that can import `lib.checkpoint`. */
function resolvePython(cwd) {
  if (process.env.OPENMONTAGE_PYTHON && process.env.OPENMONTAGE_PYTHON.trim()) {
    return process.env.OPENMONTAGE_PYTHON.trim()
  }
  const venvExe = process.platform === 'win32'
    ? join(cwd, '.venv', 'Scripts', 'python.exe')
    : join(cwd, '.venv', 'bin', 'python')
  if (existsSync(venvExe)) return venvExe
  return process.platform === 'win32' ? 'python' : 'python3'
}

/** Run `python -c code`, feeding `payload` (if given) on stdin. */
function runPython(python, cwd, code, payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-c', code], { cwd, env: process.env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('error', (error) => reject(new Error(`failed to spawn python (${python}): ${error.message}`)))
    child.on('close', (codeOut, signal) => {
      resolve({ code: codeOut ?? (signal ? 1 : 0), stdout: stdout.trim(), stderr: stderr.trim() })
    })
    if (payload !== undefined) child.stdin.write(payload)
    child.stdin.end()
  })
}

/** Probe that the OpenMontage checkpoint entry point is importable. */
const PROBE_PY = 'import sys; from lib.checkpoint import write_checkpoint; print("OK")'

/**
 * Write a checkpoint via OpenMontage's own `lib.checkpoint.write_checkpoint`.
 * `projectsDir` is the projects ROOT; projectId/stage/pipelineType come from the
 * assignment. Runs `python -c` with the payload on stdin so the checkpoint format
 * matches exactly (schema validated, gates enforced, history archived, identity
 * backfilled from the project marker when omitted).
 */
const WRITE_CHECKPOINT_PY = `
import sys, json
from pathlib import Path
from lib.checkpoint import write_checkpoint
try:
    p = json.load(sys.stdin)
except Exception as e:
    sys.stderr.write('dsh-agent-run: invalid payload: %s\\n' % e)
    sys.exit(3)
try:
    # The assignment wire carries projectsDir as a str; write_checkpoint needs a
    # Path for the 'pipeline_dir' it joins with project_id.
    path = write_checkpoint(
        Path(p['projectsDir']), p['projectId'], p['stage'], p['status'],
        p.get('artifacts') or {},
        pipeline_type=p.get('pipelineType'),
        human_approval_required=bool(p.get('humanApprovalRequired', False)),
        human_approved=bool(p.get('humanApproved', False)),
        error=p.get('error'),
        metadata=p.get('metadata'),
    )
    print(json.dumps({'ok': True, 'path': str(path)}))
except Exception as e:
    sys.stderr.write('dsh-agent-run: write_checkpoint failed: %s\\n' % e)
    sys.exit(1)
`

/** Read back the stage checkpoint the agent (or bin) wrote. */
const READ_CHECKPOINT_PY = `
import sys, json
from pathlib import Path
from lib.checkpoint import read_checkpoint
try:
    p = json.load(sys.stdin)
    cp = read_checkpoint(Path(p['projectsDir']), p['projectId'], p['stage'])
    print(json.dumps(cp if cp is not None else None))
except Exception as e:
    sys.stderr.write('dsh-agent-run: read_checkpoint failed: %s\\n' % e)
    sys.exit(1)
`

/** Map the OpenMontage gateway env vars onto the DeepSeek adapter's env vars. */
function normalizeGatewayEnv() {
  const base = process.env.OPENAI_BASE_URL || process.env.DOFE_MODEL_BASE_URL
  if (base) {
    const raw = base.replace(/\/+$/, '')
    // ALWAYS override: the DSH harness env may already carry DEEPSEEK_BASE_URL
    // (e.g. https://api.deepseek.com); the OpenMontage worker must use the dofe gateway.
    process.env.DEEPSEEK_BASE_URL = /\/v1$/.test(raw) ? raw : `${raw}/v1`
  }
  const key = process.env.DOFE_MODEL_API_KEY || process.env.OPENAI_API_KEY
  if (key) process.env.DEEPSEEK_API_KEY = key
  if (!process.env.DEEPSEEK_BASE_URL) {
    throw new Error('dsh-agent-run: no gateway base URL; set OPENAI_BASE_URL or DOFE_MODEL_BASE_URL')
  }
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error('dsh-agent-run: no gateway API key; set OPENAI_API_KEY or DOFE_MODEL_API_KEY')
  }
}

/**
 * Wait until the agent loop driver reaches idle. This is the canonical wait from
 * dsh-agent-loop's own tests (agent.spec.ts): `agent.whenIdle()` awaits the
 * loop's `activityDone` promise, so it resolves only when the driving turn has
 * actually finished — a `surface`-level 'agent/status' listener is fragile and
 * can resolve on a stale/other idle. A timeout guard turns an unstarted/hung
 * turn into a visible error instead of a silent pass.
 */
function waitForIdle(agent, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`dsh-agent-run: agent "${agent.id}" did not reach idle within ${timeoutMs}ms`))
    }, timeoutMs)
    agent.whenIdle().then(
      () => { clearTimeout(timer); resolve() },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}

/** Safe string for an error object across LLM/Tool/cancellation failures. */
function describeError(error) {
  if (error instanceof Error) return `${error.message}${error.stack ? `\n${error.stack}` : ''}`
  return String(error)
}

/** Last assistant text, for the worker's execution log. */
function finalText(events) {
  const message = events.findLast((event) => event.type === 'assistant/message')
  if (!message || message.type !== 'assistant/message') return ''
  return message.data.message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

/** Read the agent-written result manifest (if any). */
async function readResultJson(projectDir) {
  try {
    const body = await readFile(join(projectDir, RESULT_REL), 'utf8')
    return JSON.parse(body)
  } catch {
    return null
  }
}

/** Write a checkpoint; returns { ok, path?, error? }. */
async function writeCheckpoint(cwd, python, args) {
  const out = await runPython(python, cwd, WRITE_CHECKPOINT_PY, JSON.stringify(args))
  const parsed = (() => {
    try { return JSON.parse(out.stdout || '{}') } catch { return null }
  })()
  if (out.code !== 0 && !parsed?.ok) {
    return { ok: false, error: out.stderr || out.stdout }
  }
  return { ok: parsed?.ok === true, path: parsed?.path, error: parsed?.ok === true ? undefined : (out.stderr || out.stdout) }
}

/** Read the checkpoint OpenMontage's read_checkpoint returns. */
async function readCheckpoint(cwd, python, args) {
  const out = await runPython(python, cwd, READ_CHECKPOINT_PY, JSON.stringify(args))
  try { return JSON.parse(out.stdout || 'null') } catch { return null }
}

async function ensureCheckpointImportable(cwd, python) {
  const probe = await runPython(python, cwd, PROBE_PY)
  if (probe.code !== 0) {
    throw new Error(
      `dsh-agent-run: OpenMontage Python '${python}' cannot import lib.checkpoint: ${probe.stderr || probe.stdout || '(no output)'}\n`
      + 'Set OPENMONTAGE_PYTHON to the interpreter that has OpenMontage installed (e.g. the venv).',
    )
  }
}

async function main() {
  installFailLoud(NAME)

  // 1. Read stdin + assignment.
  const stdinText = await readStdin()
  const nl = stdinText.indexOf('\n')
  const firstLine = nl === -1 ? stdinText : stdinText.slice(0, nl)
  const prompt = nl === -1 ? '' : stdinText.slice(nl + 1)
  const assignmentPath = parseAssignmentPath(firstLine)
  const assignment = JSON.parse(await readFile(assignmentPath, 'utf8'))
  const {
    projectDir, projectsDir, projectId, stage, stageAttempt, pipeline,
  } = assignment

  if (!projectDir || !projectsDir || !projectId || !stage) {
    throw new Error('dsh-agent-run: assignment missing projectDir/projectsDir/projectId/stage')
  }

  // 2. Point the LLM at the gateway (env-only, no hardcoded model).
  normalizeGatewayEnv()

  // 3. Verify the OpenMontage Python entry point we write checkpoints through.
  const cwd = process.cwd()
  const python = resolvePython(cwd)
  await ensureCheckpointImportable(cwd, python)

  // 4. Load ambient .env (app-boot convention) AFTER normalization so it never
  //    overrides our gateway values.
  loadEnv(NAME)

  // 5. Best-effort in_progress heartbeat (liveness for the board). Non-fatal.
  await writeCheckpoint(cwd, python, {
    projectsDir, projectId, stage,
    status: 'in_progress',
    artifacts: {},
    pipelineType: pipeline,
  })

  // 6. Boot the agent spine headlessly, then drive one turn. A boot/create/turn
  //    failure is not fatal here: it still produces a `failed` checkpoint below.
  let ctx
  let agentRan = false
  const turnErrors = []
  try {
    ctx = await boot(NAME, CONFIG_PATH)

    // Create the agent exactly as dsh-agent-loop's tests do (agent.spec.ts):
    // provider + model only; the llm-deepseek config (maxTokens/thinking/
    // reasoningEffort) flows through the adapter's defaults.
    const model = process.env.OPENMONTAGE_AGENT_MODEL_ID || 'deepseek-v4-flash'
    const agent = ctx.agentLoop.create(
      SessionId(`openmontage-${projectId}-${stage}-${stageAttempt}-${Date.now()}`),
      { provider: 'deepseek-official', model },
    )

    // The agent loop CONTAINS turn failures: ReactLoopAgent.kick() catches them
    // and leaves the agent idle, so a failed request would otherwise surface as
    // `finalText() === ''` with no error anywhere. Capture agent/error here so
    // the real LLM/turn failure reaches stderr instead of failing silently.
    const offError = ctx.on('agent/error', ({ agent: subject, turn, step, error }) => {
      if (subject === agent) turnErrors.push(`turn ${turn} step ${step}: ${describeError(error)}`)
    })

    // 7. Drive one turn with the stage prompt.
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: prompt }],
      source: { kind: 'user' },
    }))

    const timeoutMs = Number(process.env.OPENMONTAGE_AGENT_TIMEOUT_SECONDS || 7200) * 1000
    await waitForIdle(agent, timeoutMs)
    offError()

    const events = [...agent.session.events]
    const final = finalText(events)
    // Surface the agent's conclusion on stdout for the worker's execution log.
    process.stdout.write(`${final}\n`)

    // Read the last turn/end reason: if it ended in an error (not surfaced via
    // agent/error, e.g. an early pre-step rejection), report it observably.
    const lastTurnEnd = events.findLast((event) => event.type === 'turn/end')
    if (lastTurnEnd?.data?.reason && lastTurnEnd.data.reason.kind === 'error') {
      turnErrors.push(`turn/end reason: ${describeError(lastTurnEnd.data.reason.error)}`)
    }
    agentRan = true
  } catch (error) {
    // Boot/create/turn failed; the safety net below writes a failed checkpoint.
    process.stderr.write(`dsh-agent-run: agent turn failed: ${describeError(error)}\n`)
  }
  if (turnErrors.length > 0) {
    process.stderr.write(`dsh-agent-run: agent turn reported ${turnErrors.length} error(s):\n  - ${turnErrors.join('\n  - ')}\n`)
  }

  // 8. Compute the authoritative status + artifacts, then write the checkpoint.
  //    Only honor an outcome when the agent actually ran this run (a stale
  //    result.json / checkpoint from a prior attempt must not leak in when the
  //    agent could not even boot). Prefer the result manifest, then a terminal
  //    checkpoint (never the bin's own in_progress heartbeat).
  const result = await readResultJson(projectDir)
  const agentCheckpoint = await readCheckpoint(cwd, python, { projectsDir, projectId, stage })
  let status
  let artifacts = {}
  let error
  let humanApproved = false
  if (agentRan) {
    if (result?.status) {
      status = result.status
      artifacts = result.artifacts || {}
      error = result.error
      humanApproved = result.humanApproved === true
    } else if (agentCheckpoint?.status && agentCheckpoint.status !== 'in_progress') {
      status = agentCheckpoint.status
      artifacts = agentCheckpoint.artifacts || {}
    }
  }
  if (!status) {
    status = 'failed'
    artifacts = {}
    const noOutcome = agentRan
      ? 'agent produced neither a result manifest nor a terminal checkpoint'
      : 'agent could not be started/completed for this stage'
    error = error || (turnErrors.length > 0
      ? `${noOutcome}. Turn error: ${turnErrors.join(' | ')}`
      : noOutcome)
  }

  let checkpointOut = await writeCheckpoint(cwd, python, {
    projectsDir, projectId, stage, status, artifacts,
    pipelineType: pipeline,
    humanApproved,
    error: status === 'failed' ? error : undefined,
    metadata: { stageAttempt },
  })

  if (!checkpointOut.ok) {
    // The claimed outcome could not be represented (e.g. GATE VIOLATION for a
    // gated stage, or a missing canonical artifact). Fail the stage with a
    // valid `failed` checkpoint so the worker always observes an outcome.
    process.stderr.write(
      `dsh-agent-run: could not write '${status}' checkpoint: ${checkpointOut.error}\n`,
    )
    checkpointOut = await writeCheckpoint(cwd, python, {
      projectsDir, projectId, stage, status: 'failed', artifacts: {},
      pipelineType: pipeline,
      error: `could not write '${status}' checkpoint: ${checkpointOut.error}`,
      metadata: { stageAttempt },
    })
    status = 'failed'
  }

  // 9. Teardown, then exit by outcome.
  if (ctx) {
    try {
      await ctx.fiber.dispose()
    } catch (error) {
      process.stderr.write(`dsh-agent-run: ctx dispose failed: ${error.message}\n`)
    }
  }

  if (checkpointOut.ok && (status === 'completed' || status === 'awaiting_human')) {
    process.exit(0)
  }
  process.exit(2)
}

main().catch((error) => {
  process.stderr.write(`dsh-agent-run: fatal: ${error.stack || error.message}\n`)
  process.exit(1)
})
