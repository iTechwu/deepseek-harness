# dsh-openmontage-mcp

A DeepSeek Harness (DSH) **bundle** that registers the OpenMontage MCP server as
an additional MCP client in the `web` profile, and adds a system-prompt section
telling the model when to use it.

## What it exposes

- OpenMontage's MCP tools appear as native tools with the DSH server-qualified
  namespace `mcp__openmontage__<tool>` (e.g. `mcp__openmontage__submit_video_job`).
- A prompt section (`openmontage:guidance`) instructs the model to call
  `mcp__openmontage__openmontage_capabilities` → `prepare_reference_clone` →
  `submit_video_job` for video generation / clone-recreate tasks, so the model
  reaches for OpenMontage at the right time.

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
| `MCP_BASE_URL` | Unified MCP gateway base URL | `https://ixicai.cn/mcp` |
| `MODELS_API_KEY` | Single Models API key sent to the gateway | *(required)* |

The harness container runs with host networking, which is required by DSH
(refuses `0.0.0.0`; Nginx proxies via the host loopback). A host-networked
container cannot use Docker bridge DNS, so the deployment maps the
`openmontage-mcp` service name to `127.0.0.1` with an `extra_hosts` entry — the
same loopback where the OpenMontage `openmontage-mcp` container publishes its
port (`8765`). The endpoint therefore stays stable and self-describing
(`http://openmontage-mcp:8765/mcp`) even when the OpenMontage container's bridge
address changes on recreate. Point `OPENMONTAGE_MCP_URL` at another address if
the two run on different hosts.

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
