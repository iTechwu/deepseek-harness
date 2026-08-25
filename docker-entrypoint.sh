#!/usr/bin/env bash
set -euo pipefail

: "${DSH_HOME:=/var/lib/dsh}"
export DSH_HOME

mkdir -p "${DSH_HOME}/profiles" "${DSH_HOME}/profiles/node_modules" /opt/dsh-plugins
DSH_CMD=(node /opt/dsh/lib/bin.js)

# Install optional out-of-tree plugins into the persistent web profile. Values
# may be npm specs or absolute paths supplied through a mounted volume.
if [[ -n "${DSH_PLUGIN_SPECS:-}" ]]; then
    while IFS= read -r spec; do
        [[ -n "${spec}" ]] || continue
        case "${spec}" in
            /*) [[ -e "${spec}" ]] || { echo "DSH plugin path does not exist: ${spec}" >&2; exit 1; } ;;
        esac
        "${DSH_CMD[@]}" plugin --profile web add "${spec}"
    done < <(printf '%s\n' "${DSH_PLUGIN_SPECS}" | tr ',' '\n')
fi

exec "${DSH_CMD[@]}" web --host 127.0.0.1 --port "${DEEPSEEK_HARNESS_PORT:-3080}" --no-open \
    --trusted-host "${DEEPSEEK_HARNESS_TRUSTED_HOST:-dsh.dofe.ai}"
