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

## Configuration (read at load time)

| Env var | Meaning | Default |
|---|---|---|
| `OPENMONTAGE_MCP_URL` | OpenMontage MCP endpoint | `http://openmontage-mcp:8765/mcp` |
| `OPENMONTAGE_SERVICE_TOKEN` | Bearer token OpenMontage expects (`Authorization: Bearer <token>`) | *(required — see below)* |

The harness container runs with host networking, which is required by DSH
(refuses `0.0.0.0`; Nginx proxies via the host loopback). A host-networked
container cannot use Docker bridge DNS, so the deployment maps the
`openmontage-mcp` service name to `127.0.0.1` with an `extra_hosts` entry — the
same loopback where the OpenMontage `openmontage-mcp` container publishes its
port (`8765`). The endpoint therefore stays stable and self-describing
(`http://openmontage-mcp:8765/mcp`) even when the OpenMontage container's bridge
address changes on recreate. Point `OPENMONTAGE_MCP_URL` at another address if
the two run on different hosts.

`OPENMONTAGE_SERVICE_TOKEN` must be set **in the harness container environment** —
OpenMontage's job tools authenticate with `Authorization: Bearer <token>`; without
it tool calls return 401.

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
