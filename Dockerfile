# EHBO Evenementen-app — geen externe npm-pakketten nodig.
FROM node:22-alpine

ARG APP_VERSION=dev
ARG GIT_SHA=onbekend
ARG BUILD_DATE=
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    APP_VERSION=${APP_VERSION} \
    GIT_SHA=${GIT_SHA} \
    BUILD_DATE=${BUILD_DATE}

LABEL org.opencontainers.image.title="EHBO Evenementen-app" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}"

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public

# /data is schrijfbaar voor iedere gebruiker, zodat --user 99:100 (Unraid nobody:users) ook werkt.
RUN mkdir -p /data && chmod 0777 /data
VOLUME ["/data"]

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1

CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
