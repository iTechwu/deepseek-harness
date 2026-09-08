/** Agent-local OpenMontage workflow projection and stalled-outcome circuit breaker. */

const OPENMONTAGE_PREFIX = 'mcp__openmontage__'
const PREPARE_REFERENCE = `${OPENMONTAGE_PREFIX}prepare_reference_clone`
const REFERENCE_STATUS = `${OPENMONTAGE_PREFIX}reference_clone_status`
const SUBMIT_JOB = `${OPENMONTAGE_PREFIX}submit_video_job`
const LIST_PROJECT_FILES = `${OPENMONTAGE_PREFIX}list_project_files`

const INSPECTION_TOOLS = new Set([
  `${OPENMONTAGE_PREFIX}openmontage_capabilities`,
  REFERENCE_STATUS,
  LIST_PROJECT_FILES,
  `${OPENMONTAGE_PREFIX}read_project_file`,
  `${OPENMONTAGE_PREFIX}read_project_image`,
  `${OPENMONTAGE_PREFIX}sync_project_exports`,
  `${OPENMONTAGE_PREFIX}export_project_file`,
  SUBMIT_JOB,
])

const POLLING_TOOLS = new Set([
  REFERENCE_STATUS,
  `${OPENMONTAGE_PREFIX}get_video_job`,
  `${OPENMONTAGE_PREFIX}list_video_job_events`,
])

function sortedJson(value) {
  if (Array.isArray(value)) return value.map(sortedJson)
  if (value !== null && typeof value === 'object') {
    const result = {}
    for (const key of Object.keys(value).sort()) result[key] = sortedJson(value[key])
    return result
  }
  return value
}

function parseResultObject(result) {
  for (const block of result.content) {
    if (block.type !== 'text') continue
    try {
      const parsed = JSON.parse(block.text)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch {
      // Successful non-JSON tool text has no semantic workflow status.
    }
  }
}

function isFailure(result, parsed) {
  return result.isError
    || parsed?.success === false
    || parsed?.status === 'failed'
    || parsed?.status === 'error'
}

function outcomeSignature(result, parsed) {
  return JSON.stringify(sortedJson(parsed ?? result.content))
}

function isPreparedReference(name, result, parsed) {
  if (isFailure(result, parsed)) return false
  if (name === PREPARE_REFERENCE) {
    return parsed?.status === 'prepared' || typeof parsed?.project_id === 'string'
  }
  return name === REFERENCE_STATUS && parsed?.status === 'prepared'
}

function isSubmittedJob(name, result, parsed) {
  if (name !== SUBMIT_JOB || isFailure(result, parsed) || parsed === undefined) return false
  return typeof parsed.jobId === 'string'
    || typeof parsed.job_id === 'string'
    || ['created', 'submitted', 'running'].includes(parsed.status)
}

function stalledNotice(toolName, count) {
  return {
    content: [{
      type: 'text',
      text: `OpenMontage stalled outcome detected:\n- tool: ${toolName}\n- equivalent_outcomes: ${count}\nThe previous attempts did not advance the workflow. Do not call this tool again in the current turn. Use the workflow guidance and choose an available next-stage tool, or finish with the evidence already gathered.`,
    }],
    source: {
      kind: 'plugin',
      plugin: 'openmontage-guidance',
      form: 'notice',
      summary: `${toolName} stalled × ${count}`,
    },
  }
}

function prependContext(ours, theirs) {
  return [ours, ...(theirs ?? [])]
}

/** Install OpenMontage workflow policy on the current Host context. */
export function applyWorkflowGuard(ctx, config = {}) {
  const stalledOutcomeThreshold = config.stalledOutcomeThreshold ?? 3
  if (!Number.isInteger(stalledOutcomeThreshold) || stalledOutcomeThreshold < 2) {
    throw new Error(`openmontage-guidance: stalledOutcomeThreshold must be an integer >= 2, got ${stalledOutcomeThreshold}`)
  }

  const states = new Map()

  function stateFor(agent) {
    let state = states.get(agent)
    if (state === undefined) {
      state = {
        inspection: false,
        restriction: undefined,
        outcomes: new Map(),
        openTools: new Set(),
      }
      states.set(agent, state)
    }
    return state
  }

  function clearRestriction(state) {
    state.restriction?.()
    state.restriction = undefined
    state.inspection = false
  }

  function clearAgent(agent) {
    const state = states.get(agent)
    if (state === undefined) return
    clearRestriction(state)
    states.delete(agent)
  }

  function refreshRestriction(agent, state) {
    state.restriction?.()
    state.restriction = undefined
    const deny = ctx.tools.schemas()
      .map(schema => schema.name)
      .filter(toolName => toolName.startsWith('mcp__') && !INSPECTION_TOOLS.has(toolName))
    if (deny.length > 0) state.restriction = agent.ctx.tools.restrict({ deny })
    state.inspection = true
  }

  function observeOutcome(exec, result) {
    if (exec.agent === undefined || !exec.name.startsWith(OPENMONTAGE_PREFIX)) return
    const state = stateFor(exec.agent)
    const parsed = parseResultObject(result)

    if (isPreparedReference(exec.name, result, parsed)) refreshRestriction(exec.agent, state)
    if (isSubmittedJob(exec.name, result, parsed)) clearRestriction(state)

    if (POLLING_TOOLS.has(exec.name) || state.openTools.has(exec.name)) return
    const failure = isFailure(result, parsed)
    if (!failure && exec.name !== LIST_PROJECT_FILES) {
      state.outcomes.delete(exec.name)
      return
    }

    const signature = outcomeSignature(result, parsed)
    const previous = state.outcomes.get(exec.name)
    const count = previous?.signature === signature ? previous.count + 1 : 1
    state.outcomes.set(exec.name, { signature, count })
    if (count < stalledOutcomeThreshold) return
    state.openTools.add(exec.name)
    return stalledNotice(exec.name, count)
  }

  ctx.tools.guard(exec => {
    if (exec.agent === undefined) return
    if (!states.get(exec.agent)?.openTools.has(exec.name)) return
    return `OpenMontage stalled-outcome circuit is open for "${exec.name}" in this turn. Do not retry it; follow the latest OpenMontage guidance or finish the task.`
  })

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const notice = observeOutcome(exec, result)
    const downstream = await next()
    if (notice === undefined) return downstream
    if (downstream.kind === 'block') {
      return {
        kind: 'block',
        feedback: downstream.feedback,
        additionalContexts: prependContext(notice, downstream.additionalContexts),
      }
    }
    return {
      ...downstream,
      additionalContexts: prependContext(notice, downstream.additionalContexts),
    }
  })

  ctx.on('agent/pre-step', ({ agent, messages }, next) => {
    if (messages.some(message => message.source.kind === 'user')) {
      clearAgent(agent)
    } else {
      const state = states.get(agent)
      if (state?.inspection) refreshRestriction(agent, state)
    }
    return next()
  })

  ctx.on('agent/disposed', ({ agent }) => clearAgent(agent))
  ctx.effect(() => () => {
    for (const state of states.values()) clearRestriction(state)
    states.clear()
  }, 'openmontage-guidance: clear workflow guards')
}
