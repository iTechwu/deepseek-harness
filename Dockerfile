# DeepSeek Harness runtime image. The CLI and every runtime dependency are
# built and packed from this checkout; the final image has no source checkout.

ARG NODE_BASE_IMAGE=uhub.service.ucloud.cn/techwu/node:25.9-bookworm-slim
FROM ${NODE_BASE_IMAGE} AS build

ARG NPM_REGISTRY=https://registry.npmjs.org/
ARG PNPM_FETCH_TIMEOUT=300000
ARG PNPM_FETCH_RETRIES=5
ARG PNPM_NETWORK_CONCURRENCY=8
# The build records the source commit into the client bundle without needing a
# .git checkout, so Jenkins can provide this value at image-build time.
ARG DSH_CLIENT_COMMIT_HASH=0000000

ENV PNPM_CONFIG_FETCH_TIMEOUT=${PNPM_FETCH_TIMEOUT} \
    PNPM_CONFIG_FETCH_RETRIES=${PNPM_FETCH_RETRIES} \
    PNPM_CONFIG_NETWORK_CONCURRENCY=${PNPM_NETWORK_CONCURRENCY} \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:${PATH} \
    DSH_CLIENT_COMMIT_HASH=${DSH_CLIENT_COMMIT_HASH} \
    TZ=Asia/Shanghai

RUN npm config set registry "${NPM_REGISTRY}" \
    && npm install --global pnpm@11.7.0 \
    && pnpm config set registry "${NPM_REGISTRY}"

WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile \
    && pnpm run build -- --profile official \
    && pnpm run release:pack --family dsh --out /opt/dsh-packages \
    && pnpm run release:pack --family vendor --out /opt/vendor-packages

FROM ${NODE_BASE_IMAGE} AS runtime

ARG NPM_REGISTRY=https://registry.npmjs.org/
ENV NODE_ENV=production \
    DSH_HOME=/var/lib/dsh \
    DSH_TELEMETRY_DISABLED=1 \
    PNPM_HOME=/pnpm \
    PATH=/opt/dsh/node_modules/.bin:/pnpm:${PATH} \
    TZ=Asia/Shanghai

COPY --from=build /opt/dsh-packages /opt/dsh-packages
COPY --from=build /opt/vendor-packages /opt/vendor-packages
RUN npm config set registry "${NPM_REGISTRY}" \
    && npm install --global pnpm@11.7.0 \
    && mkdir -p /opt/dsh /pnpm /var/lib/dsh/profiles /var/lib/dsh/profiles/node_modules /opt/dsh-plugins \
    && npm install --prefix /opt/dsh --omit=dev --no-audit --no-fund \
      /opt/dsh-packages/*.tgz /opt/vendor-packages/*.tgz \
    && chown -R node:node /var/lib/dsh /opt/dsh /opt/dsh-plugins /pnpm

# ============================================================================
# Browser tooling: Google Chrome + OpenCLI
# ----------------------------------------------------------------------------
# The harness drives a real Chrome session through the OpenCLI CLI (site
# adapters + `opencli browser *`). Bake both into the runtime image so they
# survive container recreates. Node >= 20 is already present in the base.
# Set NPM_REGISTRY/CHROME_DEB_URL/NODE_DIST_URL to reachable mirrors.
# ============================================================================
ARG CHROME_DEB_URL=https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
ARG NODE_DIST_URL=https://npmmirror.com/mirrors/node
RUN set -eux; \
    export DEBIAN_FRONTEND=noninteractive; \
    apt-get update; \
    apt-get install -y --no-install-recommends curl ca-certificates gnupg; \
    curl -fsSL -o /tmp/google-chrome.deb "${CHROME_DEB_URL}"; \
    apt-get install -y /tmp/google-chrome.deb; \
    rm -f /tmp/google-chrome.deb; \
    npm config set registry "${NPM_REGISTRY}"; \
    npm install -g @jackwener/opencli; \
    google-chrome --version; \
    opencli --version

COPY --chown=node:node docker-entrypoint.sh /usr/local/bin/dsh-entrypoint
RUN chmod 0755 /usr/local/bin/dsh-entrypoint

USER node
EXPOSE 3080
VOLUME ["/var/lib/dsh", "/opt/dsh-plugins"]

ENTRYPOINT ["/usr/local/bin/dsh-entrypoint"]
