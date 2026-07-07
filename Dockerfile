# Single-image deployment (SPEC.md section 9 item 6): one container serves
# the built client and the WebSocket on the same origin.
FROM node:20-alpine AS base
WORKDIR /repo
RUN corepack enable

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/engine/package.json packages/engine/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/bots/package.json packages/bots/package.json
COPY tools/sim/package.json tools/sim/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm -r --filter="./packages/**" build
RUN pnpm --filter @leekha/web build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /repo/apps/server/package.json ./apps/server/package.json
COPY --from=build /repo/apps/server/src ./apps/server/src
COPY --from=build /repo/apps/web/dist ./apps/server/web-dist

WORKDIR /repo/apps/server
ENV PORT=8080
EXPOSE 8080
CMD ["./node_modules/.bin/tsx", "src/index.ts"]
