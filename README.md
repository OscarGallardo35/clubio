# Mi SaaS - Fidelización Gastronómica

SaaS multitenant de fidelización para negocios gastronómicos con PWAs nativas, backend escalable y despliegue automatizado en Railway + Cloudflare.

## Descripción

**Mi SaaS** permite a negocios gastronómicos (bares, restaurantes, cafeterías) gestionar programas de fidelización con:

- **2 QRs fijos** accesibles desde cualquier dispositivo
- **Sistema de sellos/puntos** automatizado
- **Gestión de personal** con PIN seguro
- **Panel de administración** completo con CRM, marketing y análisis
- **Notificaciones push** en tiempo real
- **Integración con Google Business Profile** para reseñas

## Arquitectura

```
┌─────────────────────────────────────────────────────────┐
│                    CLOUDFLARE (CDN + WAF)               │
│                  *.dominio.com (Wildcard)               │
└────────────────────────────────────────────────────────┬┘
                                                          │
                    ┌─────────────────────────────────────┘
                    │
        ┌───────────┴──────────────┬────────────┬───────────┐
        │                          │            │           │
   ┌────▼────┐  ┌─────────────┐  │  ┌────────┐ │  ┌──────┐ │
   │ Backend  │  │PWA Cliente  │  │  │PWA     │ │  │PWA   │ │
   │NestJS    │  │Next.js 14   │  │  │Staff   │ │  │Admin │ │
   │api.*     │  │app.*        │  │  │staff.* │ │  │admin.││
   └────┬─────┘  └─────────────┘  │  └────────┘ │  └──────┘ │
        │                          │             │           │
        └──────────────────────────┴─────────────┴───────────┘
                        RAILWAY (Single Project)
                                 │
                    ┌────────────┴─────────────┐
                    │                          │
              ┌─────▼──────┐          ┌────────▼────┐
              │ PostgreSQL  │          │    Redis    │
              │   Database  │          │   Cache     │
              └─────────────┘          └─────────────┘
```

## Stack Tecnológico

### Backend
- **NestJS 10+** - Framework NodeJS escalable
- **Prisma 5+** - ORM typesafe con migraciones
- **PostgreSQL 16** - Base de datos relacional
- **Redis 7+** - Cache y sesiones
- **WebSockets** - Comunicación en tiempo real
- **JWT** - Autenticación dual (empleado/dueño)

### Frontend (PWAs)
- **Next.js 14** - Framework React con SSR
- **TypeScript 5+** - Tipado estricto
- **Tailwind CSS** - Estilos utility-first
- **shadcn/ui** - Componentes Radix UI
- **Socket.io Client** - WebSockets en cliente

### Infraestructura
- **Turborepo** - Monorepo orchestration
- **pnpm 9+** - Package manager monorepo
- **Railway** - Hosting y base de datos
- **Cloudflare** - CDN, DNS y WAF
- **Docker** - Multi-stage builds optimizados

## Estructura del Monorepo

```
mi-saas/
├── apps/
│   ├── backend/                 # NestJS + Prisma
│   │   ├── src/
│   │   ├── prisma/
│   │   ├── Dockerfile
│   │   ├── railway.toml
│   │   └── package.json
│   ├── pwa-cliente/             # Next.js 14
│   │   ├── app/
│   │   ├── Dockerfile
│   │   ├── railway.toml
│   │   └── package.json
│   ├── pwa-staff/               # Next.js 14
│   │   └── ...
│   └── pwa-admin/               # Next.js 14
│       └── ...
├── packages/
│   ├── config/                  # ESLint, TypeScript, Tailwind
│   ├── types/                   # Tipos compartidos
│   ├── validators/              # Esquemas Zod
│   ├── utils/                   # Funciones utilitarias
│   ├── api-client/              # Cliente HTTP tipado
│   └── ui/                      # Componentes shadcn/ui
├── turbo.json
├── package.json
├── pnpm-workspace.yaml
├── docker-compose.yml
├── .env.example
└── README.md
```

## Requisitos Previos

- **Node.js 20+** ([descargar](https://nodejs.org))
- **pnpm 9+** (instalar con `corepack enable`)
- **Docker & Docker Compose** ([descargar](https://docker.com))
- **Git** ([descargar](https://git-scm.com))

## Instalación y Desarrollo Local

### 1. Clonar el repositorio

```bash
git clone https://github.com/tu-usuario/mi-saas.git
cd mi-saas
```

### 2. Activar pnpm

```bash
corepack enable
corepack prepare pnpm@9.12.0 --activate
```

### 3. Instalar dependencias

```bash
pnpm install
```

### 4. Configurar variables de entorno

Hay **un único `.env`, en la raíz del monorepo** (fuente única de verdad).

```bash
cp .env.example .env
# Editar .env con tus valores
```

- El backend lo carga con `ConfigModule` (`envFilePath: ['../../.env']`).
- Los comandos de Prisma (`db:*`) lo cargan con `dotenv -e ../../.env --`.
- **NO** crear `apps/backend/.env`: el backend no lo lee y se desincroniza del de la raíz.

### 5. Levantar Postgres y Redis

```bash
docker compose up -d
```

### 6. Configurar base de datos

```bash
# Generar cliente Prisma
pnpm db:generate

# Ejecutar migraciones
pnpm db:migrate

# (Opcional) Seed con datos de prueba
pnpm db:seed
```

### 7. Iniciar desarrollo

```bash
pnpm dev
```

**URLs disponibles:**
- Backend: http://localhost:3000
- PWA Cliente: http://localhost:3001
- PWA Staff: http://localhost:3002
- PWA Admin: http://localhost:3003

## Scripts Disponibles

| Script | Descripción |
|--------|-------------|
| `pnpm dev` | Inicia todas las apps en modo desarrollo (Turborepo) |
| `pnpm build` | Compila todas las apps |
| `pnpm lint` | Ejecuta ESLint en todo el monorepo |
| `pnpm format` | Formatea código con Prettier |
| `pnpm typecheck` | Valida tipos TypeScript |
| `pnpm clean` | Limpia builds, node_modules y cache |
| `pnpm db:generate` | Genera cliente Prisma |
| `pnpm db:migrate` | Ejecuta migraciones en desarrollo |
| `pnpm db:deploy` | Ejecuta migraciones en producción |
| `pnpm db:studio` | Abre Prisma Studio (UI visual de BD) |
| `pnpm db:seed` | Ejecuta seed con datos de prueba |

## Variables de Entorno

### General
```env
NODE_ENV=development
```

### Backend
```env
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mi_saas?schema=public
REDIS_URL=redis://localhost:6379

# JWT Secrets (cambiar en producción)
JWT_SECRET=cambiar-en-produccion
JWT_EMPLEADO_SECRET=cambiar-en-produccion
JWT_DUENO_SECRET=cambiar-en-produccion
JWT_CLIENTE_SECRET=cambiar-en-produccion
JWT_REFRESH_SECRET=cambiar-en-produccion

# JWT Expiration
JWT_EMPLEADO_EXPIRES_IN=12h
JWT_DUENO_EXPIRES_IN=7d
JWT_CLIENTE_EXPIRES_IN=30d
JWT_REFRESH_EXPIRES_IN=30d

# CORS
CORS_ORIGINS=http://localhost:3001,http://localhost:3002,http://localhost:3003

# Push Notifications (VAPID)
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@dominio.com

# Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/auth/google/callback

# Google Pub/Sub (para Business Profile)
GOOGLE_PUBSUB_TOPIC=
GOOGLE_PUBSUB_VERIFICATION_TOKEN=

# Google Places API
GOOGLE_PLACES_API_KEY=
```

### Frontend (PWAs)
```env
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_WS_URL=ws://localhost:3000
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
NEXT_PUBLIC_PLACES_API_KEY=
NEXT_PUBLIC_DEFAULT_TENANT=bar-slug
NEXT_PUBLIC_APP_VERSION=1.0.0
```

## Migraciones de Prisma

### Crear nueva migración

```bash
# Después de cambiar schema.prisma
pnpm db:migrate --name nombre_migracion
```

### Aplicar migraciones

```bash
# Desarrollo
pnpm db:migrate

# Producción
pnpm db:deploy
```

### Visualizar base de datos

```bash
pnpm db:studio
```

## Deploy en Railway

### 1. Crear cuenta en Railway

Ir a [railway.app](https://railway.app) y crear una cuenta.

### 2. Crear proyecto

- Dashboard → New Project → GitHub (conectar repo)
- Seleccionar rama `main`

### 3. Agregar servicios

#### a) PostgreSQL
- New → Database → PostgreSQL
- Railway crea automáticamente `DATABASE_URL`

#### b) Redis
- New → Database → Redis
- Railway crea automáticamente `REDIS_URL`

#### c) Backend (NestJS)
- New → GitHub Repo → Seleccionar tu repo
- Settings:
  - Root Directory: (leave blank para monorepo)
  - Build Command: (usar Dockerfile)
  - Dockerfile Path: `apps/backend/Dockerfile`
  - Start Command: `node dist/main.js`
  - Port: 3000
- Environment:
  - `NODE_ENV` = `production`
  - `JWT_SECRET` = (generar valor fuerte)
  - `JWT_*_SECRET` = (generar valores fuertes)
  - Otros secrets según `.env.example`
- Agregar variable interna: `RUN_MIGRATIONS_ON_START=true`

#### d) PWA Cliente
- New → GitHub Repo
- Settings:
  - Dockerfile Path: `apps/pwa-cliente/Dockerfile`
  - Start Command: `node apps/pwa-cliente/server.js`
  - Port: 3000
  - Environment: mismo que Backend

#### e) PWA Staff
- Repetir proceso con `apps/pwa-staff/Dockerfile`

#### f) PWA Admin
- Repetir proceso con `apps/pwa-admin/Dockerfile`

### 4. Configurar dominios

En Railway, para cada servicio:

- Backend → Domain → `api.dominio.com`
- PWA Cliente → Domain → `app.dominio.com`
- PWA Staff → Domain → `staff.dominio.com`
- PWA Admin → Domain → `admin.dominio.com`

### 5. Desplegar

```bash
# Hacer push a main (Railway deploya automáticamente)
git push origin main
```

## Configuración de Cloudflare

### 1. Añadir dominio

- Dashboard → Websites → Add site
- Ingresar `dominio.com`
- Usar nameservers de Cloudflare

### 2. Crear registros DNS

| Tipo | Nombre | Valor | Proxied |
|------|--------|-------|---------|
| CNAME | api | backend.up.railway.app | ✓ |
| CNAME | app | pwa-cliente.up.railway.app | ✓ |
| CNAME | staff | pwa-staff.up.railway.app | ✓ |
| CNAME | admin | pwa-admin.up.railway.app | ✓ |
| CNAME | * | pwa-cliente.up.railway.app | ✓ |

*Reemplazar `*.up.railway.app` con los valores reales de Railway*

### 3. SSL/TLS

- SSL/TLS → Overview → Full (Strict)
- Always Use HTTPS: ON
- Automatic HTTPS Rewrites: ON

### 4. Cache Rules

Crear las siguientes reglas:

**Regla 1: Estáticos (1 año)**
- Path: `(*.js OR *.css OR *.png OR *.woff2 OR *.svg)`
- Cache Level: Cache Everything
- Edge TTL: 1 year

**Regla 2: HTML (No cachear)**
- Path: `(index.html OR sw.js)`
- Cache Level: Bypass

**Regla 3: API (No cachear)**
- Path: `/api/*`
- Cache Level: Bypass

### 5. Optimizaciones

- Speed → Optimization
  - Brotli: ON
  - Auto Minify: ON (JavaScript, CSS, HTML)
  - Early Hints: ON
  - HTTP/3 (QUIC): ON

### 6. Seguridad

- Security → Bot Management
  - Bot Fight Mode: ON
- Rate Limiting: 100 req/min por IP
- WAF Managed Rules: ON

## Subdominios por Tenant

La arquitectura soporta subdominios dinámicos: `{tenant-slug}.dominio.com`

### Configuración

1. En Cloudflare, crear registro wildcard:
   ```
   * CNAME pwa-cliente.up.railway.app
   ```

2. En backend, extraer tenant desde header `X-Tenant-Slug`:
   ```typescript
   const tenant = req.headers['x-tenant-slug'] as string
   ```

3. En PWA, obtener tenant del subdominio:
   ```typescript
   const subdomain = getSubdominio(window.location.hostname)
   ```

## Seguridad Multitenant

### 1. Row-Level Security (RLS) en PostgreSQL

Todas las queries incluyen `WHERE negocioId = $tenantId`:

```sql
CREATE POLICY tenant_isolation ON clientes
  USING (negocioId = current_setting('app.current_tenant')::uuid);
```

### 2. Validación de tenant en cada request

```typescript
// En backend, middleware valida que:
// - Usuario pertenece al tenant
// - Recursos pertenecen al tenant
// - Tokens contienen tenant
```

### 3. Rate limiting

- 100 req/min por IP (Cloudflare)
- 1000 req/min por usuario (Backend)

## Troubleshooting

### Error: "Cannot find module '@repo/types'"

- Ejecutar: `pnpm install`
- Verificar rutas en `tsconfig.base.json`

### Error: "database: unknown database \"mi_saas\""

- Verificar `DATABASE_URL` en `.env`
- Ejecutar: `pnpm db:migrate`

### Error: "CORS error"

- Verificar `CORS_ORIGINS` en backend `.env`
- En development: `http://localhost:3001,http://localhost:3002,http://localhost:3003`
- En production: `https://app.dominio.com,https://staff.dominio.com,https://admin.dominio.com`

### Error: "Port 3000 already in use"

```bash
# Matar proceso
lsof -i :3000 | grep LISTEN | awk '{print $2}' | xargs kill -9

# O usar puerto diferente
PORT=3100 pnpm dev
```

### Redis connection refused

```bash
# Verificar que Redis esté corriendo
docker compose ps

# Si no está, iniciar
docker compose up -d redis
```

## Roadmap Futuro

### Fase 2 (Escalabilidad)
- [ ] Migrar PWAs a Cloudflare Pages (gratis, 300+ edge locations)
- [ ] Migrar PostgreSQL a Neon (backups automáticos, branching)
- [ ] Dejar Railway solo para backend NestJS

### Fase 3 (Características)
- [ ] Integración completa Google Business Profile (OAuth + Pub/Sub)
- [ ] Sistema de notificaciones push mejorado (Bull Queue + scheduler)
- [ ] Panel de super-admin para gestión de múltiples negocios
- [ ] Tests automatizados (unitarios + e2e)

### Fase 4 (Monetización)
- [ ] Landing page pública para captar negocios
- [ ] Sistema de billing con Stripe o Mercado Pago
- [ ] Dashboard de analytics avanzado

## Consideraciones Importantes

### Archivos a NUNCA commitear
- `.env` (credenciales)
- `apps/*/node_modules`
- `packages/*/node_modules`
- `dist/`, `.next/`

### Secretos en Producción
- En Railway, usar UI → Settings → Environment
- Nunca guardar secrets en código o .env commiteado
- Rotar secrets regularmente

### Backups
- Railway hace backups automáticos de PostgreSQL
- Configurar backup externo a S3 si es crítico
- Testear restauración regularmente

### Logs Centralizados
- Configurar Logtail o Better Stack si crece
- Monitoreo con New Relic o Datadog

## Contribuir

1. Crear rama: `git checkout -b feature/nombre`
2. Hacer cambios y testear localmente
3. `pnpm lint && pnpm format`
4. Hacer commit: `git commit -m 'feat: descripción'`
5. Push: `git push origin feature/nombre`
6. Crear Pull Request

## Licencia

Privada - Todos los derechos reservados

## Contacto

- Email: tu-email@dominio.com
- Soporte: https://discord.gg/tu-servidor

---

**Generado con Turborepo + Prisma + NestJS + Next.js**

Última actualización: 2026-10-05
