# ============ Base ============
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# ============ Dependencies ============
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/pwa-admin/package.json apps/pwa-admin/
COPY packages/config/package.json packages/config/
COPY packages/types/package.json packages/types/
COPY packages/validators/package.json packages/validators/
COPY packages/utils/package.json packages/utils/
COPY packages/ui/package.json packages/ui/
COPY packages/api-client/package.json packages/api-client/
RUN pnpm install --frozen-lockfile --prod=false

# ============ Builder ============
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/pwa-admin/node_modules ./apps/pwa-admin/node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter pwa-admin build

# ============ Runner ============
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/apps/pwa-admin/public ./apps/pwa-admin/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/pwa-admin/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/pwa-admin/.next/static ./apps/pwa-admin/.next/static
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "apps/pwa-admin/server.js"]
