# dsh-geo-mcp

GEO bundle for DSH. It registers GeoFlow and GEORank through the unified public MCP gateway and injects one routing guide for the agent.

Required environment:

```dotenv
MCP_BASE_URL=https://ixicai.cn/mcp
MODELS_API_KEY=sk-...
```

The bundle exposes `mcp__geoflow__*` and `mcp__georank__*`. It does not accept project-specific tokens or tenant parameters. The gateway derives tenant identity from the Models key.

Install with `dsh plugin --profile web add ./dsh-geo-mcp` or include `/opt/dsh-plugins/dsh-geo-mcp` in `DSH_PLUGIN_SPECS`.
