# dsh-agent-run — smoke test plan

Two layers need verification:

1. **The OpenMontage contract** (stdin parsing, assignment identity, checkpoint
   write through `lib.checkpoint`) — fully verifiable without building the harness
   monorepo, because Python is available in the OpenMontage venv.
2. **The DeepSeek Harness spine boot + one-turn drive** — requires the monorepo to
   be installed/built (it imports several workspace packages), which we could not
   run here. Those checks are listed explicitly and marked ⚠️.

## 1. OpenMontage contract (run now — PASSES)

All of these were executed against the OpenMontage repo with its venv
(`.venv/bin/python`, Python 3.10 + jsonschema 4.26).

### 1a. Checkpoint write/read identity (assignment → checkpoint)

The bin writes the checkpoint with `Path(projectsDir), projectId, stage, status,
artifacts, pipeline_type=pipeline`. Confirmed:

- `write_checkpoint`/`read_checkpoint` produce
  `projectsDir/<projectId>/checkpoint_<stage>.json`.
- `project_id`, `pipeline_type`, `stage` match the assignment's identity — exactly
  what `AgentCommandPipelineExecutor.execute` re-checks at
  `openmontage/pipeline_executor.py:411-432`.
- `status: in_progress` with empty `artifacts` writes fine (heartbeat).
- `status: completed` with empty `artifacts` **fails** for a canonical stage
  (`research`) with `Stage 'research' with status 'completed' must include
  canonical artifact 'research_brief'` — proving schema/gate enforcement. The bin
  therefore converts a claimed `completed` without the canonical artifact into a
  `failed` checkpoint (the "could not write" fallback).
- `status: failed` with an `error` writes fine (no canonical artifact required).

### 1b. Full scenario (agent wrote `result.json`)

Simulated an agent that produced a schema-valid `research_brief` artifact and a
`{projectDir}/.openmontage/agent-run/result.json` with `status:"completed"`. The
bin's resolution + `write_checkpoint` produced a valid `completed` checkpoint with
correct identity and the artifact present.

### 1c. The bin's embedded Python constants

Extracted `WRITE_CHECKPOINT_PY` and `READ_CHECKPOINT_PY` from `bin/agent-run.js`
and ran them through `.venv/bin/python -c` with the same JSON payload shape the bin
sends (`projectsDir` as a **string**, converted to `Path` inside the snippet).
Both work. The string→`Path` conversion is essential — `write_checkpoint` joins
`pipeline_dir / project_id`, and the assignment wire carries `projectsDir` as a
`str` (`StageAssignment.to_wire()` → `pipeline_executor.py:144`).

### 1d. stdin first-line parsing

`parseAssignmentPath` handles:
- `OPENMONTAGE_ASSIGNMENT_PATH="/abs/path.json"` (JSON-quoted, from `_stage_prompt`,
  `pipeline_executor.py:666`)
- paths with spaces
- Windows backslash paths (`json.dumps` escaping, resolved via `JSON.parse`)
- a bare/quote-wrapped path (robustness)

All cases pass.

## 2. DeepSeek Harness spine (⚠️ needs monorepo install/build)

The following could not be executed here (the workspace packages are not linked for
the plugin dir in this checkout, and the task forbids a full pnpm build). Verify
after `pnpm install`:

- [ ] `node plugins/dsh-agent-run/bin/agent-run.js` resolves
      `@deepseek-ai/dsh-app-boot`, `@deepseek-ai/dsh-agent-spine-demo`,
      `@deepseek-ai/dsh-bash-local`, `@deepseek-ai/dsh-subprocess-local`,
      `@deepseek-ai/dsh-session`, `@deepseek-ai/dsh-llm`,
      `@deepseek-ai/dsh-llm-deepseek`.
- [ ] `boot('dsh-agent-run', plugins/dsh-agent-run/cordis.yml)` activates the tree;
      `ctx.agentLoop` exists (`@deepseek-ai/dsh-agent-loop` registers it).
- [ ] `ctx.agentLoop.create(SessionId(...), { provider:'deepseek-official', model })`
      yields an agent; `agent.followup(...)` + `waitForIdle` drives one turn and
      reaches `idle`.
- [ ] The DeepSeek adapter reads `baseURL`/`apiKeyEnv` from `DEEPSEEK_BASE_URL` /
      `DEEPSEEK_API_KEY` (no credentials plugin mounted) — see
      `packages/llm/llm-deepseek/src/index.ts:359-361,411-432` and
      `packages/util/launch-environment/src/index.ts:114-117`.
- [ ] The bash tool runs `python ...` from the OpenMontage ROOT (bash executor
      `cwd = process.cwd()`).

### End-to-end local run (once built)

```sh
# From the OpenMontage repo (cwd = the checkout), with a fake/real gateway:
OPENMONTAGE_PROJECTS_DIR=/tmp/om-e2e \
OPENMONTAGE_AGENT_EXECUTOR_JSON='["node","<abs>/plugins/dsh-agent-run/bin/agent-run.js"]' \
OPENAI_BASE_URL="$DOFE_MODEL_BASE_URL/v1" \
OPENAI_API_KEY="$DOFE_MODEL_API_KEY" \
  openmontage/venv/bin/python -c "..."   # orchestrate via AgentCommandPipelineExecutor
```

Or drive the bin directly:

```sh
cp <abs>/cordis.yml /tmp/agent-run.cordis.yml
printf 'OPENMONTAGE_ASSIGNMENT_PATH="/tmp/assign.json"\nExecute the research stage.\n' \
  | node <abs>/plugins/dsh-agent-run/bin/agent-run.js
```

where `/tmp/assign.json` is a `StageAssignment.to_wire()` JSON with `projectsDir`,
`projectId`, `stage`, `pipeline`.

## Contracts captured while reading (for the report)

- Executor spawns argv `["node", "<abs>/bin/agent-run.js"]` with `{project_dir}`
  substituted; `cwd=ROOT`; stdin = `_stage_prompt()`; env carries the gateway
  (`openmontage/pipeline_executor.py:253-292,439-457,658-679`).
- First stdin line = `OPENMONTAGE_ASSIGNMENT_PATH="<path>"` (`pipeline_executor.py:666`).
- Checkpoint identity re-check: `project_id == assignment.project_id`,
  `pipeline_type == assignment.pipeline`, `stage == assignment.stage`
  (`pipeline_executor.py:425-432`).
- Executor requires exit code 0; a non-zero exit raises before reading the
  checkpoint (`pipeline_executor.py:404-409`).
- `write_checkpoint(pipeline_dir, project_id, stage, status, artifacts, ...)` where
  `pipeline_dir` is the **projects root**; statuses ∈
  `{completed, failed, awaiting_human, in_progress}` (`lib/checkpoint.py:422-564`).
- `completed`/`awaiting_human` require the stage's canonical artifact
  (`lib/checkpoint.py:134-143`); a gated `completed` without approval raises
  `GATE VIOLATION` (`lib/checkpoint.py:477-494`).
- DeepSeek adapter base URL appends `/chat/completions`; set it to `<gateway>/v1`
  (`packages/llm/llm-deepseek/src/adapter.ts:607`).
