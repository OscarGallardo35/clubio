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
# El API se inyecta en BUILD time (Next inlinea los NEXT_PUBLIC_*): Railway pasa las variables
# del servicio como build args con el mismo nombre. El default es la API publica y no la URL
# interna, para que una build sin la var apunte a algo usable.
ARG NEXT_PUBLIC_API_URL=https://api.clubio.lat
ARG NEXT_PUBLIC_WS_URL=https://api.clubio.lat
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
RUN pnpm --filter pwa-admin build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
# PORT no se setea a proposito: Railway inyecta el suyo. Fijarlo rompe el healthcheck
# (misma leccion que en el backend).
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=builder --chown=nextjs:nodejs /app/apps/pwa-admin/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/pwa-admin/.next/static ./apps/pwa-admin/.next/static
# El admin SI tiene public/ (el manifest de la PWA): a diferencia del staff, este COPY no se
# omite. Un COPY de una fuente inexistente rompe el build con "failed to compute cache key".
COPY --from=builder --chown=nextjs:nodejs /app/apps/pwa-admin/public ./apps/pwa-admin/public
USER nextjs
EXPOSE 3000
CMD ["node", "apps/pwa-admin/server.js"]
