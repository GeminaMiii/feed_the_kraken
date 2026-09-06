# ===== 构建 =====
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm install --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/engine/tsconfig.json packages/engine/
COPY packages/server/tsconfig.json packages/server/
COPY packages/client/tsconfig.json packages/client/
COPY packages/engine/src packages/engine/src
COPY packages/server/src packages/server/src
COPY packages/client/src packages/client/src
COPY packages/client/index.html packages/client/
COPY packages/client/vite.config.ts packages/client/
RUN npm run -w packages/engine build \
 && npm run -w packages/server build \
 && npm run -w packages/client build

# ===== 运行 =====
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/server/package.json packages/server/
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/engine/dist packages/engine/dist
COPY --from=build /app/packages/engine/package.json packages/engine/
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/server/package.json packages/server/
COPY --from=build /app/packages/client/dist packages/client/dist
ENV FTK_DB=/app/data/ftk.db PORT=3000 HOST=0.0.0.0
VOLUME ["/app/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3000/healthz || exit 1
WORKDIR /app/packages/server
CMD ["node", "dist/index.js"]
