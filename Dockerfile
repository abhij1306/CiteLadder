# CiteLadder self-hosted image: the API serves the built browser app on one
# origin, and the same image runs the background runner.
#
# Node 26 strips the service's erasable TypeScript at load time, so the image
# ships source rather than a compiled bundle.
FROM node:26-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"
WORKDIR /app

# Keep this version in lockstep with packageManager in frontend/package.json.
RUN npm install --global --ignore-scripts pnpm@12.16.1

COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
COPY frontend/packages/contracts/package.json ./packages/contracts/
COPY frontend/packages/mcp-app/package.json ./packages/mcp-app/
COPY frontend/services/api/package.json ./services/api/
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY frontend ./

# Optional build-time setting baked into the browser bundle.
ARG NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE=
ENV NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE=${NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE}

# The browser app (static files) and the MCP Apps view the API embeds.
RUN pnpm build \
    && pnpm --filter @citeladder/mcp-app build \
    && mkdir -p services/api/assets/mcp-app/v1 \
    && cp packages/mcp-app/dist/analytics.html services/api/assets/mcp-app/v1/analytics.html

# Export only the API's production graph, not the workspace-wide store.
RUN pnpm --filter @citeladder/api deploy --prod --ignore-scripts /runtime
# Node strips workspace TypeScript only outside node_modules, so keep the
# contracts package linked to a source directory, as in development.
RUN mkdir -p /runtime/packages \
    && mv "$(readlink -f /runtime/node_modules/@citeladder/contracts)" /runtime/packages/contracts \
    && ln -sfn ../../packages/contracts /runtime/node_modules/@citeladder/contracts \
    && cp -r apps/app/dist /runtime/public

FROM node:26-bookworm-slim AS runtime

ENV NODE_ENV=production \
    APP_ENV=production \
    HOST=0.0.0.0 \
    PORT=8100 \
    STATIC_DIR=/app/public \
    CITELADDER_DATA_DIR=/data
WORKDIR /app

COPY --from=build --chown=0:0 /runtime ./
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/citeladder-entrypoint
RUN mkdir -p /data && chown node:node /data

USER node
VOLUME ["/data"]
EXPOSE 8100

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:8100/ready').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["citeladder-entrypoint"]
CMD ["server"]
