# EHBO Evenementen-app: Fastify-server met de gebouwde Vue-app, in één container.

# ---- Bouwen: typen controleren en de webapp bouwen (de tests draaien in CI) ----
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY shared shared
COPY server server
COPY web web
# Alleen de workspaces: de end-to-end-test (e2e/) zit niet in het image en draait in CI.
RUN npm run typecheck --workspaces --if-present && npm run build

# ---- Draaien: alleen de runtime-pakketten van de server ----
FROM node:26-alpine

ARG APP_VERSION=dev
ARG GIT_SHA=onbekend
ARG BUILD_DATE=
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    WEB_DIR=/app/web/dist \
    APP_VERSION=${APP_VERSION} \
    GIT_SHA=${GIT_SHA} \
    BUILD_DATE=${BUILD_DATE}

LABEL org.opencontainers.image.title="EHBO Evenementen-app" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}"

WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
# De webapp heeft alleen pakketten nodig tijdens het bouwen; die staan in devDependencies.
RUN npm ci --omit=dev && npm cache clean --force
COPY shared/src shared/src
COPY server/src server/src
COPY --from=build /app/web/dist web/dist

# /data is schrijfbaar voor iedere gebruiker, zodat --user 99:100 (Unraid nobody:users) ook werkt.
RUN mkdir -p /data && chmod 0777 /data
VOLUME ["/data"]

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null || exit 1

# Node draait de TypeScript-bestanden direct (type stripping); er is geen aparte compileerstap voor de server.
CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/index.ts"]
