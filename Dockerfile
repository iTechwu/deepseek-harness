# DeepSeek Harness runtime image. The published CLI package owns its complete
# bundle; this image runs the CLI from the built workspace so that every
# workspace/vendored link (@deepseek-ai/cordis -> @deepseek-ai/cosmokit, ...)
# resolves at runtime without needing a sibling source checkout.

ARG NODE_BASE_IMAGE=uhub.service.ucloud.cn/techwu/node:25.9-bookworm-slim
FROM ${NODE_BASE_IMAGE} AS build

ARG NPM_REGISTRY=https://registry.npmjs.org/
ARG PNPM_FETCH_TIMEOUT=300000
ARG PNPM_FETCH_RETRIES=5
ARG PNPM_NETWORK_CONCURRENCY=8
# The build records the source commit into the client bundle without needing a
# .git checkout, so the gate-free image build keeps this value from pull-time.
ARG DSH_CLIENT_COMMIT_HASH=0000000

ENV PNPM_CONFIG_FETCH_TIMEOUT=${PNPM_FETCH_TIMEOUT} \
    PNPM_CONFIG_FETCH_RETRIES=${PNPM_FETCH_RETRIES} \
    PNPM_CONFIG_NETWORK_CONCURRENCY=${PNPM_NETWORK_CONCURRENCY} \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:${PATH} \
    TZ=Asia/Shanghai

RUN npm config set registry "${NPM_REGISTRY}" \
    && npm install --global pnpm@11.7.0 \
    && pnpm config set registry "${NPM_REGISTRY}"

WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile \
    && DSH_CLIENT_COMMIT_HASH=${DSH_CLIENT_COMMIT_HASH} pnpm run build

FROM ${NODE_BASE_IMAGE} AS runtime

ARG NPM_REGISTRY=https://registry.npmjs.org/
ENV NODE_ENV=production \
    DSH_HOME=/var/lib/dsh \
    DSH_TELEMETRY_DISABLED=1 \
    PNPM_HOME=/pnpm \
    PATH=/src/node_modules/.bin:/pnpm:${PATH} \
    TZ=Asia/Shanghai

RUN npm config set registry "${NPM_REGISTRY}" \
    && npm install --global pnpm@11.7.0 \
    && mkdir -p /pnpm /var/lib/dsh/profiles /var/lib/dsh/profiles/node_modules /opt/dsh-plugins \
    && chown -R node:node /var/lib/dsh /opt/dsh-plugins /pnpm

COPY --from=build --chown=node:node /src /src
COPY --chown=node:node docker-entrypoint.sh /usr/local/bin/dsh-entrypoint
RUN chmod 0755 /usr/local/bin/dsh-entrypoint

USER node
EXPOSE 3080
VOLUME ["/var/lib/dsh", "/opt/dsh-plugins"]

ENTRYPOINT ["/usr/local/bin/dsh-entrypoint"]
