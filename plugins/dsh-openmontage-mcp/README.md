# dsh-openmontage-mcp

A DeepSeek Harness (DSH) **bundle** that registers the OpenMontage MCP server as
an additional MCP client in the `web` profile, and adds a system-prompt section
telling the model when to use it.

## What it exposes

- OpenMontage's MCP tools appear as native tools with the DSH server-qualified
  namespace `mcp__openmontage__<tool>` (e.g. `mcp__openmontage__submit_video_job`).
- A prompt section (`openmontage:guidance`) instructs the model to call
  `mcp__openmontage__openmontage_capabilities` → `prepare_reference_clone` →
  `submit_video_job` for scripted, multi-shot, edited, or clone-recreate tasks.
  A 5–10 second continuous single-shot clip belongs to the Media MCP instead.

`prepare_reference_clone` is a synchronous, long-running operation because it
may download a source video and run ffmpeg/transcription analysis. The bundle
allows up to 10 minutes for this call. If a client reports a timeout, keep the
returned `project_id` and call `mcp__openmontage__reference_clone_status` before
retrying; completed projects are reused on retry. Once the status is
`prepared`, call `list_project_files`. For JSON/Markdown analysis files, use
`read_project_file` so a remote client receives the text over the authenticated
MCP channel; do not pass the CI-only `/exchange/openmontage/<project_id>` path
to a local `Read` tool. Use `sync_project_exports` or `export_project_file` only
when a shared mount or media delivery is needed.

## Configuration (read at load time)

| Env var | Meaning | Default |
|---|---|---|
| `MODELS_API_KEY` | Single Models API key sent to the gateway | *(required)* |

The MCP endpoint is fixed at `https://ixicai.cn/mcp/montage`; users do not
configure a CI-only base URL.

The gateway validates `MODELS_API_KEY`; no OpenMontage service token or job attribution is configured in DSH.

`failOnStartupError` is `false`: if OpenMontage is briefly unreachable the web
profile still boots and the reconnect supervisor registers the tools once the
server is back.

## Install

Shipped through the deployment's plugin mount and `DSH_PLUGIN_SPECS`:

```sh
# in docker-helm.dofe.ai .env
DEEPSEEK_HARNESS_PLUGIN_SOURCE_DIR=../deepseek-harness/plugins
DSH_PLUGIN_SPECS=/opt/dsh-plugins/dsh-openmontage-mcp
```

Or, from a checkout:

```sh
dsh plugin --profile web add ./dsh-openmontage-mcp
```
