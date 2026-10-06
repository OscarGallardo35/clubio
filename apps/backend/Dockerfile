# ============ Base ============
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# ============ Dependencies ============
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
# El .npmrc de la raiz (si existe) tiene que viajar junto al lockfile: el install de la imagen
# tiene que leer las mismas settings que el install local. Y ademas se le agrega el linker
# hoisted: con el linker por defecto (symlinks) `apps/backend/node_modules` queda lleno de
# links relativos al store de la raiz (`node_modules/.pnpm`), que el stage runner NO copia ->
# el contenedor arrancaba con "Cannot find module '@nestjs/core'".
COPY .npmrc* ./
# Ojo: el .npmrc de la raiz trae `node-linker=isolated` explicito. No alcanza con appendear
# (depende de cual gana): reemplazo la linea y, si no existiera, la agrego.
RUN sed -i 's/^node-linker=.*/node-linker=hoisted/' .npmrc && grep -q '^node-linker=hoisted' .npmrc || echo 'node-linker=hoisted' >> .npmrc
COPY apps/backend/package.json apps/backend/
COPY packages/config/package.json packages/config/
COPY packages/types/package.json packages/types/
COPY packages/validators/package.json packages/validators/
COPY packages/utils/package.json packages/utils/
RUN pnpm install --frozen-lockfile --prod=false

# ============ Builder ============
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY . .
RUN pnpm --filter backend db:generate
RUN pnpm --filter backend build

# ============ Runner ============
FROM base AS runner
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nestjs
COPY --from=builder --chown=nestjs:nodejs /app/apps/backend/dist ./dist
# El runner corre `node dist/main.js` desde /app, asi que la resolucion de modulos empieza
# en /app/node_modules: hay que copiar el node_modules de la RAIZ (ahi quedan los paquetes
# reales con node-linker=hoisted). Copiar solo apps/backend/node_modules no alcanza.
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=builder --chown=nestjs:nodejs /app/apps/backend/prisma ./prisma
COPY --from=builder --chown=nestjs:nodejs /app/apps/backend/package.json ./
# TEMPORAL: sonda de diagnostico del deploy (se retira con el fix real). Dispara re-deploy via webhook.
RUN echo '=== SONDA /app ===' && ls -la /app | head -15 && \
    echo '=== SONDA /app/node_modules (primeros) ===' && ls /app/node_modules 2>&1 | head -15 && \
    echo '=== SONDA /app/node_modules/@nestjs ===' && ls -la /app/node_modules/@nestjs 2>&1 | head -12 && \
    echo '=== SONDA @nestjs/core ===' && ls -la /app/node_modules/@nestjs/core 2>&1 | head -6 && \
    echo '=== SONDA apps/backend ===' && ls -la /app/apps/backend 2>&1 | head -10 && \
    echo '=== SONDA fin ==='
USER nestjs
EXPOSE 3000
ENV PORT=3000
CMD ["node", "dist/main.js"]
