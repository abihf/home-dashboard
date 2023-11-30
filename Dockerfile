FROM node:20-alpine AS base

FROM base AS builder
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
RUN --mount=type=cache,target=/app/.svelte-kit npm run build
RUN npm prune --production

FROM base AS runner
WORKDIR /app

COPY package.json ./
COPY --link --from=builder /app/node_modules ./node_modules
COPY --link --from=builder /app/build ./build

USER node
ENV NODE_ENV production
ENV PORT 3000
ENV HOSTNAME "0.0.0.0"
EXPOSE ${PORT}
CMD ["node", "build/index.js"]
