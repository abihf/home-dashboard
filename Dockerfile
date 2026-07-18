FROM oven/bun:1-alpine AS base

FROM base AS builder
WORKDIR /app

COPY package.json bun.lock bunfig.toml ./
RUN --mount=type=cache,target=/root/.bun bun install
COPY . .
RUN --mount=type=cache,target=/app/.svelte-kit bun run build
RUN --mount=type=cache,target=/root/.bun rm -rf node_modules && bun install --production

FROM base AS runner
WORKDIR /app

COPY package.json ./
COPY --link --from=builder /app/node_modules ./node_modules
COPY --link --from=builder /app/build ./build

USER bun
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE ${PORT}
CMD ["bun", "build/index.js"]
