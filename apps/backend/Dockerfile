# ============ Base ============
FROM node:20-alpine AS base
# openssl va en el BASE, no en el runner: `prisma generate` corre en los stages de build y elige el
# engine segun la version de openssl que ve. Si el runner tiene openssl 3.0 y el generate no lo veia,
# Prisma copiaba el engine de openssl-1.1.x y el runtime fallaba con
# "could not locate the Query Engine for runtime linux-musl-openssl-3.0.x". Misma version en todos
# los stages = mismo target.
RUN apk add --no-cache openssl \
    && corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# ============ Dependencies ============
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
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
# En un workspace pnpm CADA package tiene su propio node_modules (los links a sus deps + su .bin).
# Se buildea @repo/types en este stage, asi que hace falta el suyo: su tsconfig hace `extends` de
# @repo/config y su `tsc` sale de ese .bin. Sin esto: TS6053 '@repo/config/tsconfig.base.json not
# found'. Los demas packages no lo necesitan: no se buildean aca y el backend solo importa
# @repo/types (los otros @repo/* de su package.json no se usan en src).
COPY --from=deps /app/packages/types/node_modules ./packages/types/node_modules
COPY . .
RUN pnpm --filter backend db:generate
# @repo/types PRIMERO: el backend lo consume desde dist (su tsconfig tiene rootDir: ./src, asi que
# no puede importar los .ts de otro package). Si esto se saca, el build del backend falla con TS6059.
RUN pnpm --filter @repo/types build
RUN pnpm --filter backend build

# ============ Deploy ============
# `pnpm deploy` arma un arbol autocontenido: las dependencias de produccion quedan como
# directorios REALES, sin symlinks al store de la raiz. Es la unica forma de que el runtime no
# dependa del layout de node_modules del builder (ver TROUBLESHOOTING, hallazgo 8).
# OJO: deploy re-instala @prisma/client en modo produccion, asi que el cliente GENERADO
# (node_modules/.prisma) no viaja solo: hay que copiarlo a mano. El `test -d` es a proposito:
# si no queda ahi, el build falla AQUI, con el log a la vista, en vez de morir en runtime.
FROM builder AS deploy
# El cliente de Prisma se genera DENTRO de /app/out, no se copia: el generador escribe en el
# node_modules/.prisma del arbol donde corre, asi que sale con la ruta y el engine correctos y no
# hay que adivinar donde lo dejo el store de pnpm (que es distinto en Linux y en Windows).
# El CLI sale del builder (/app/node_modules/.bin/prisma), donde prisma esta como devDependency.
RUN pnpm --filter backend deploy --prod /app/out \
    && PRISMA_CLI=$(find /app -path '*/prisma/build/index.js' -not -path '/app/out/*' 2>/dev/null | head -1) \
    && echo "prisma cli: $PRISMA_CLI" \
    && test -n "$PRISMA_CLI" \
    && cd /app/out \
    && node "$PRISMA_CLI" generate --schema=prisma/schema.prisma \
    && GEN=$(find /app/out/node_modules -type d -path '*/.prisma/client' 2>/dev/null | head -1) \
    && echo "cliente generado en: $GEN" \
    && test -n "$GEN"

# ============ Runner ============
FROM base AS runner
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nestjs
COPY --from=deploy --chown=nestjs:nodejs /app/out ./
USER nestjs
EXPOSE 3000
ENV PORT=3000
CMD ["node", "dist/main.js"]
