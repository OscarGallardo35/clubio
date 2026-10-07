FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

FROM base AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY . .
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app ./
COPY . .
ARG NEXT_PUBLIC_API_URL=https://backend-production-8ebe8.up.railway.app
ARG NEXT_PUBLIC_WS_URL=https://backend-production-8ebe8.up.railway.app
ARG NEXT_PUBLIC_DEFAULT_TENANT=bar-la-esquina
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_DEFAULT_TENANT=$NEXT_PUBLIC_DEFAULT_TENANT
RUN pnpm --filter pwa-cliente build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
# PORT no se setea a proposito: Railway inyecta el suyo. Fijarlo rompe el healthcheck
# (misma leccion que en el backend).
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=builder --chown=nextjs:nodejs /app/apps/pwa-cliente/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/pwa-cliente/.next/static ./apps/pwa-cliente/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/pwa-cliente/public ./apps/pwa-cliente/public
USER nextjs
EXPOSE 3000
CMD ["node", "apps/pwa-cliente/server.js"]
