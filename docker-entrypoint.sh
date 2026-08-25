#!/usr/bin/env bash
set -euo pipefail

: "${DSH_HOME:=/var/lib/dsh}"
export DSH_HOME

# Prefer a fast China registry for any runtime npm/pnpm (plugin installs).
# NPM_REGISTRY (from the deployment env) wins; otherwise default to the mirror.
npm config set registry "${NPM_REGISTRY:-https://registry.npmmirror.com}" >/dev/null 2>&1 || true
pnpm config set registry "${NPM_REGISTRY:-https://registry.npmmirror.com}" >/dev/null 2>&1 || true

mkdir -p "${DSH_HOME}/profiles" "${DSH_HOME}/profiles/node_modules" /opt/dsh-plugins
DSH_CMD=(node /opt/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js)

# Install optional out-of-tree plugins into the persistent web profile. Values
# may be npm specs or absolute paths supplied through a mounted volume.
if [[ -n "${DSH_PLUGIN_SPECS:-}" ]]; then
    while IFS= read -r spec; do
        [[ -n "${spec}" ]] || continue
        case "${spec}" in
            /*) [[ -e "${spec}" ]] || { echo "DSH plugin path does not exist: ${spec}" >&2; exit 1; } ;;
        esac
        # A single failed plugin spec (e.g. an npm marketplace that needs
        # registry access) must not take the whole dsh process down: log it and
        # keep booting so the remaining plugins still load.
        if ! "${DSH_CMD[@]}" plugin --profile web add "${spec}"; then
            echo "DSH plugin install failed (continuing; profile may lack it): ${spec}" >&2
        fi
    done < <(printf '%s\n' "${DSH_PLUGIN_SPECS}" | tr ',' '\n')
fi

exec "${DSH_CMD[@]}" web --host 127.0.0.1 --port "${DEEPSEEK_HARNESS_PORT:-3080}" --no-open \
    --trusted-host "${DEEPSEEK_HARNESS_TRUSTED_HOST:-dsh.dofe.ai}"
