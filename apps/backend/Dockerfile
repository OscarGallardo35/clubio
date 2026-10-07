# ============ Base ============
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
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
COPY . .
RUN pnpm --filter backend db:generate
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
    && test -d node_modules/.prisma/client \
    && ls node_modules/.prisma/client | head -5

# ============ Runner ============
FROM base AS runner
ENV NODE_ENV=production
# openssl es obligatorio para Prisma en Alpine: sin el, el motor no arranca y la app muere
# al conectar. El propio log del build lo avisa ("Prisma failed to detect the libssl/openssl
# version to use... Please manually install OpenSSL").
RUN apk add --no-cache openssl \
    && addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nestjs
COPY --from=deploy --chown=nestjs:nodejs /app/out ./
USER nestjs
EXPOSE 3000
ENV PORT=3000
CMD ["node", "dist/main.js"]
