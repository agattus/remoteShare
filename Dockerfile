FROM node:22-slim AS build
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/server packages/server
COPY packages/viewer packages/viewer
COPY packages/desktop/package.json packages/desktop/package.json
RUN npm ci --ignore-scripts \
      --workspace=@remotedesk/shared --workspace=@remotedesk/server --workspace=@remotedesk/viewer --include-workspace-root \
 && npm run build -w @remotedesk/viewer \
 && npm run build -w @remotedesk/server

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=47831 DATA_DIR=/data
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/viewer/dist packages/viewer/dist
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 47831
USER node
CMD ["node", "packages/server/dist/index.mjs"]
