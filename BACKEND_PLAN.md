# Plan de implementación — Backend NestJS

Deriva de los 8 prompts en `01_prompts_por_modulo/02_Backend/`.
Ruta del código: `prompts_fideliza_v2/apps/backend/`.

---

## 0. Estado de partida (YA HECHO)

| Pieza | Estado |
|---|---|
| Monorepo Turborepo + pnpm | ✅ |
| Schema Prisma consolidado | ✅ 38 modelos + 17 enums |
| Migración `20261005174926_init` | ✅ aplicada en Neon |
| RLS (`prisma/rls.sql`) | ✅ 22 tablas / 44 políticas |
| Seed completo | ✅ 242 filas |
| Repo GitHub | ✅ `OscarGallardo35/clubio` |
| `tsc` / `prisma validate` | ✅ sin errores |

---

## ⚠️ Insight crítico antes de empezar

Los prompts **2.5 → 2.11 incluyen cambios de schema + migraciones**, pero nuestro
`schema.prisma` es el **CONSOLIDADO FINAL**: ya contiene `Pedido`, `GrupoModificador`,
`OpcionModificador`, `ReglaUpsell`, `Turno`, `EncargadoDia`, `CheckinTurno`,
`PlanFeature`, `UsoMensual`, `Sucursal`, `ConfiguracionSucursal`,
`ItemCartaSucursal`, `TarjetaClienteSucursal` y `SuperAdmin`.

Lo mismo con el RLS: ya está aplicado (22 tablas).

**Regla de trabajo:** de los prompts 2.5 → 2.11 tomar **solo el código NestJS**.
**NO** volver a aplicar sus bloques de schema ni sus migraciones — romperían la DB
y duplicarían lo que ya está.

Excepción a revisar: la "migración Fase 2" del Prompt #2.10 (backfill de sucursal
principal) — nuestro seed ya creó sucursales y `TarjetaClienteSucursal`, así que hay
que adaptarla a idempotente-sobre-datos-existentes, no ejecutarla a ciegas.

---

## Fases

### Fase 1 — Prompt #2 · Backend Base
**Archivo:** `05_Prompt_02_Backend_Base.md`

Esqueleto de todo. Sin esto no hay nada.

- `main.ts`: CORS (3 dominios + localhost), helmet, compression, cookie-parser,
  `ValidationPipe` global (`whitelist/transform/forbidNonWhitelisted`),
  `HttpExceptionFilter`, `LoggingInterceptor`, prefijo global `/api`, escucha `0.0.0.0`.
- `app.module.ts`: ConfigModule global, ThrottlerModule, ScheduleModule,
  BullModule (Redis), PrismaModule global, todos los módulos, `APP_GUARD`.
- `prisma/`: `PrismaService` (`$connect`/`$disconnect`, shutdown hooks).
- `common/`: decorators (`tenant`, `roles`, `current-*`, `public`),
  guards (`jwt-empleado`, `jwt-cliente`, `jwt-dueno`, `roles`, `tenant`),
  interceptors, filters, utils (`crypto`, `pagination`).
- `auth/`: 3 controladores separados (empleado/cliente/dueño) + strategies + DTOs.
  PIN con bcrypt, lockout 5 intentos/10 min, 2FA para dueño, `SesionEmpleado/Dueno`.
- Módulos: `negocios`, `configuracion`, `clientes` (+`segmentos`),
  `visitas` (+gateway WS `visita:solicitada|aprobada|rechazada`), `empleados`,
  `carta`, `delivery`, `push` (processor+scheduler), `resenas`, `google` (OAuth),
  `estadisticas`, `webhooks`.
- ❌ **NO** crear `modos-mesa/` ni endpoints de modos de mesa.

**Verificación:** `pnpm --filter backend build` compila · `nest start` levanta ·
`GET /api/health` responde.

---

### Fase 2 — Prompt #2.5 · Blindaje multitenant
**Archivo:** `06_Prompt_02_5_Multitenant_Security.md`

- `withTenant()` por transacción (setea `app.current_negocio_id`).
- `AsyncLocalStorage` para no pasar `negocioId` a mano en cada servicio.
- `TenantGuard` con **validación cruzada JWT ↔ subdominio**.
- `ThrottlerGuard` por tenant.
- `AdminPrismaService` (rol `admin_role`, bypass RLS) para super-admin.
- Módulo `super-admin` mínimo.
- Tests e2e de aislamiento.

**Ya hecho:** RLS + roles PG (`app_user`, `admin_role`, `migration_role`) existen en la DB.
**Falta:** el código NestJS que los usa.

**Verificación:** test e2e de aislamiento (tenant A no ve datos de B).

---

### Fase 3 — Prompt #2.6 · Pedidos
**Archivo:** `07_Prompt_02_6_Backend_Pedidos.md`

**Reemplaza el módulo `delivery` de la Fase 1.**

- Módulo `pedidos`: service, controller, gateway WS namespace `/pedidos`, scheduler.
- Endpoints: crear, listar, detalle, cambiar estado, cancelar, estadísticas.
- Link corto: token 128 bits, expira 4 h, sin login (`GET /pedidos/publico/:linkToken`).
- Mensaje WhatsApp pre-armado.
- WS con salas por cliente / pedido / negocio.
- Precios **siempre recalculados desde la BD** (nunca confiar en el cliente).
- Validación de transiciones de estado.
- Rate limiting específico para endpoints públicos.
- Cron: limpieza + recordatorios.

**Ya en schema:** `Pedido` con `tipo`, `modoPago`, `mesa`, `subtotal`, `linkToken`, etc.

---

### Fase 4 — Prompt #2.7 · Modificadores + Upsell
**Archivo:** `08_Prompt_02_7_Backend_Modificadores_Upsell.md`

- CRUD de grupos de modificadores + opciones con `precioExtra`.
- Asignación de grupos a items (individual y bulk) + duplicar grupo.
- Validaciones: min/max selecciones, grupos obligatorios.
- CRUD de reglas de upsell (prioridad, activación).
- **Motor de upsell**: calcula sugerencias en tiempo real (NO persiste nada).
- Validación estricta de modificadores al crear pedidos.
- `calcular-totales.ts` con precio final + extras.
- Caché Redis para grupos y reglas.

**Verificación:** crear pedido con modificador inválido → rechazado.

---

### Fase 5 — Prompt #2.8 · Turnos + Check-in + Asignación
**Archivo:** `09_Prompt_02_8_Backend_Turnos_Checkin.md`

- CRUD de turnos + vista semanal + duplicar semana/día.
- Validación de solapamiento por empleado.
- Encargado del día (único por fecha).
- Check-in/check-out + historial + cierre automático a medianoche.
- **Asignación de pedidos** con 3 modos: `BROADCAST`, `POR_ROL`, `SOLO_ENCARGADO`.
- Fallbacks: sin turnos → notificar a todos los activos.
- `PATCH /pedidos/:id/tomar` (solo BROADCAST).
- WS `pedido:nuevo` solo a los notificados.
- Caché Redis de vista semanal.

**Depende de:** Fase 3 (modifica pedidos).

---

### Fase 6 — Prompt #2.9 · Gating + Límites
**Archivo:** `10_Prompt_02_9_Backend_Gating_Limites.md`

- `PlanService`: lee `PlanFeature` con caché Redis (TTL 10 min, invalidar al cambiar).
- `PlanGuard` + `@RequiereFeature()`.
- `LimitesService` + `UsoMensualService` con colchón de gracia (50 por defecto).
- Estados `NORMAL` / `ADVERTENCIA` / `EXCEDIDO`; notificar al 100% y 150%.
- Bloquear al 150% salvo `payPerUseActivo === true`.
- Cron: reset mensual (día 1, 00:05), recordatorio diario, reconciliación semanal, reporte mensual.
- Endpoints dueño (`/planes/mi-plan`, `/planes/uso-mensual`) y super-admin.
- Push + email al 100% y 150%.

**Ya en DB:** 57 `PlanFeature` del seed.

**Depende de:** todos los módulos que consumen recursos (va casi al final).

---

### Fase 7 — Prompt #2.10 · CRUD Sucursales + Config Override
**Archivo:** `11_Prompt_02_10_Backend_CRUD_Sucursales.md`

- CRUD de `Sucursal` + validación de límite por plan.
- Sucursal principal (no eliminable, cambiable).
- Soft delete con `force` para reasignar empleados.
- Estadísticas por sucursal (comparativa con la principal).
- `ConfiguracionSucursal` con override campo por campo (null → hereda global).
- `ItemCartaSucursal` con override de precio/disponibilidad.
- `GET /carta?sucursalId=X` y `GET /configuracion/publica?sucursalId=X`.
- Script de migración idempotente + cron de reconciliación.
- Caché Redis.

⚠️ **Adaptar la migración**: nuestra DB ya tiene sucursales (seed), así que el backfill
debe ser idempotente sobre datos existentes.

---

### Fase 8 — Prompt #2.11 · Refactor multi-sucursal
**Archivo:** `12_Prompt_02_11_Backend_Refactor_MultiSucursal.md`

- `SucursalResolverService` (multi-fuente + caché).
- Refactor de **todos** los módulos para multi-sucursal: visitas, pedidos, turnos,
  checkin, asignación, push, clientes, empleados, carta, configuracion, negocios,
  auth-cliente, WebSockets (salas por sucursal), push.scheduler, estadisticas, super-admin.
- Regla: `GLOBAL` actualiza `Cliente` + `TarjetaClienteSucursal`;
  `POR_SUCURSAL` solo `TarjetaClienteSucursal`.
- RLS sigue siendo por `negocioId`, **no** por `sucursalId`.

---

## Orden y dependencias

```
Fase 1 (Base)
   └─► Fase 2 (Seguridad MT)
          └─► Fase 3 (Pedidos)   [reemplaza delivery]
                 ├─► Fase 4 (Modificadores + Upsell)
                 └─► Fase 5 (Turnos + Asignación)
                        └─► Fase 6 (Gating + Límites)
                               └─► Fase 7 (Sucursales + Override)
                                      └─► Fase 8 (Refactor multi-sucursal)
```

## Decisión de diseño a tomar

El Prompt #2.11 **refactoriza todo** lo construido en las fases 3-7. Dos caminos:

- **A (fiel a los prompts):** implementar mono-sucursal y después refactorizar. Más pasos,
  pero cada prompt queda "como fue pensado".
- **B (recomendado):** construir multi-sucursal **desde la Fase 3** (usar
  `SucursalResolverService` desde el inicio) y usar el Prompt #2.11 solo como **checklist
  de verificación**. Ahorra reescribir 5 módulos.

## Verificación transversal (aplicar en cada fase)

```bash
pnpm --filter backend build          # compila
pnpm --filter backend lint           # sin errores
npx prisma validate                  # schema válido
pnpm --filter backend start:dev      # levanta
curl localhost:3000/api/health       # responde
```
Y por fase: el test unit/e2e que indica cada prompt.

## Documentos de apoyo (no son fases, son insumos)

- `02_documentacion_y_schema/README_Proyecto.md`, `00_CONTEXTO.md`
- `02_documentacion_y_schema/CICD_GitHub_Actions_Workflows.md`
- `02_documentacion_y_schema/Docker_Compose_Config.yml`
- `01_prompts_por_modulo/07_Integraciones/` (Google GBP, push) — posterior
- `01_prompts_por_modulo/08_Testing/` — posterior
