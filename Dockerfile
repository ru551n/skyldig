# syntax=docker/dockerfile:1

# The deps and build stages run on the build machine's own architecture ($BUILDPLATFORM):
# `pnpm build` emits plain JavaScript that is identical for every target, so it only needs to
# run once, natively. Running it under QEMU for linux/arm64 crashed Vite's native bundler with
# "qemu: uncaught target signal 4 (Illegal instruction)" and hung the release build.
FROM --platform=$BUILDPLATFORM node:24-alpine@sha256:50c8e8ca1d27439048670df5883f32d57cf81cff6233222c893fd0d9884cbd81 AS build-base
WORKDIR /app
RUN corepack enable

FROM build-base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM build-base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# Production dependencies are installed per target architecture, so any native module matches
# the image it ships in.
FROM node:24-alpine@sha256:50c8e8ca1d27439048670df5883f32d57cf81cff6233222c893fd0d9884cbd81 AS prod-deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM node:24-alpine@sha256:50c8e8ca1d27439048670df5883f32d57cf81cff6233222c893fd0d9884cbd81 AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/drizzle ./drizzle
COPY server.js ./server.js

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/health" || exit 1

CMD ["node", "server.js"]
