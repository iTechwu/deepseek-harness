# dsh-geoflow-mcp

A DeepSeek Harness (DSH) **bundle** that registers `geoflow` (`geo.dofe.ai`, Laravel) as an
additional MCP client in the `web` profile, and adds a system-prompt section telling the model
when to use it.

## What it exposes

- Geoflow's MCP tools appear as native tools under the DSH server-qualified namespace
  `mcp__geoflow__*`. Geoflow's own tool names already carry a `geoflow.` project prefix
  (e.g. `geoflow.tasks.list`); the DSH mcp-client sanitizes `.` → `_` and appends a short
  hash on lossy normalization, so the model-facing public names look like
  `mcp__geoflow__geoflow_<group>_<action>_<hash>` (note the doubled `geoflow`). The model
  discovers the exact names from the tool catalog.
- A prompt section (`geoflow:guidance`) instructs the model to reach for geoflow for
  content/catalog, site, distribution, lead, enterprise-knowledge, analytics, URL-import and
  system operations on `geo.dofe.ai`.

## Configuration (read at load time)

| Env var | Meaning | Default |
| --- | --- | --- |
| `MCP_BASE_URL` | Unified MCP gateway base URL | `https://ixicai.cn/mcp` |
| `MODELS_API_KEY` | Single Models API key sent to the gateway | *(required)* |

The MCP gateway supplies the trusted upstream host and validates `MODELS_API_KEY`; the plugin does not perform a second project-level authentication.

`failOnStartupError` is `false`: if geoflow is briefly unreachable the web profile still boots
and the reconnect supervisor registers the tools once the server is back.

## Install

Shipped through the deployment's plugin mount and `DSH_PLUGIN_SPECS`:

```sh
# in docker-helm.dofe.ai .env
DEEPSEEK_HARNESS_PLUGIN_SOURCE_DIR=../deepseek-harness/plugins
DSH_PLUGIN_SPECS=/opt/dsh-plugins/dsh-geoflow-mcp
```

Or, from a checkout:

```sh
dsh plugin --profile web add ./dsh-geoflow-mcp
```
