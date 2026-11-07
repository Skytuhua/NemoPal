FROM node:24.14.0-bookworm-slim AS build
WORKDIR /app
ENV CI=true ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN npm install --global pnpm@10.30.3

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/cloud/package.json ./apps/cloud/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/nemotron/package.json ./packages/nemotron/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY tsconfig.json tsconfig.base.json ./
COPY apps/cloud/src ./apps/cloud/src
COPY packages/contracts/src ./packages/contracts/src
COPY packages/nemotron/src ./packages/nemotron/src
RUN pnpm exec esbuild apps/cloud/src/main.ts --bundle --platform=node --format=esm --target=node24 --external:fastify --external:pg --outfile=apps/cloud/dist/main.js

FROM node:24.14.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production LP_MODEL_LIVE_OPT_IN=false LP_DEMO_TIMING=false LP_REMINDERS_CONSENT=false
# Keep tsx from the frozen dev dependencies for the unbundled SQL migration CLI.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/tsconfig.json /app/tsconfig.base.json ./
COPY --from=build /app/apps/cloud ./apps/cloud
COPY --from=build /app/packages/contracts ./packages/contracts
USER node
CMD ["node", "apps/cloud/dist/main.js"]
