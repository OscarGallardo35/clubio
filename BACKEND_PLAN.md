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

---

## Tareas pendientes

- [x] **Regenerar `packages/types`** — HECHO (antes del Lote 3).
      Reescrito desde el schema: 18 enums identicos + entidades + DTOs de respuesta.
      `tsc --noEmit` limpio. Sigue SIN importar `@prisma/client` (tipos manuales).

- [x] **Unificar el manejo del `.env`.** HECHO (antes del Lote 2).
      Un solo `/.env` en la raíz: `ConfigModule` con `envFilePath: ['../../.env']`,
      scripts de Prisma con `dotenv -e ../../.env --`, y `apps/backend/.env` eliminado.

---

## Decisiones tomadas

- **Validación**: `class-validator` en los DTOs del backend; Zod (`@repo/validators`) queda para
  las PWAs. Si aparece una regla de negocio compleja (ej. validar un pedido completo), se evalúa
  un `ZodValidationPipe` custom.
- **Enums en el backend**: siempre desde `@prisma/client`, nunca desde `@repo/types` (desactualizado).

---

## Progreso

| Lote | Contenido | Estado |
|---|---|---|
| 1 | Infraestructura base + healthcheck + ESLint | ✅ `a3a0d6d` |
| 2 | Auth dual (lockout por negocio, claim `tipo`, E.164, rotación de refresh) | ✅ verificado e2e |
| 3 | Core negocio (negocios, configuracion, clientes, empleados) | ✅ verificado e2e |
| 4 | Fidelización + Carta (visitas + WS, carta) | ✅ verificado e2e |
| 5 | Soporte (push, resenas, google, estadisticas, webhooks) | ✅ verificado e2e |

## Tareas pendientes (nuevas)

- [x] **Secretos JWT distintos** — HECHO. 6 secretos aleatorios de 64 hex; `requireEnv()` lanza
      en produccion si falta alguno. Verificado: token forjado con el secreto de cliente y claim
      `tipo="dueno"` -> **401** (antes solo lo frenaba el claim).
- [x] Regenerar `packages/types` (ver arriba). HECHO.


---

## Lote 3 — Core Negocio (cerrado)

Refinamientos implementados: `SucursalResolverService` (4 fuentes + cache Redis),
envelope `{ data, total, page, pageSize }`, soft delete (`eliminadoEn`), auditoria en
`EventoAuditoria`, RBAC con `@Roles()`, negocio con `plan`/`modoClientes`/`features`/
`sucursalesActivas`, cliente con sellos/puntos/visitas + tarjetas por sucursal + historial.

### 3 bugs reales encontrados y corregidos

1. **`tsc` emitia `packages/types` y desplazaba la salida a `dist/apps/backend/src/`**
   Causa: un unico `import type { PaginatedResponse } from '@repo/types'` en
   `pagination.util.ts` metia el TS fuente del paquete en el program y subia el rootDir
   inferido a la raiz del monorepo, rompiendo `node dist/main.js`.
   Fix: el backend define su propio `PaginatedResponse<T>` (mismo contrato) y se agrego
   `"rootDir": "./src"` al tsconfig para que no vuelva a pasar en silencio.
   Regla: **el backend no importa TS fuente de otros paquetes del monorepo.**

2. **`prebuild: rimraf dist` + `"incremental": true` => dist VACIO.**
   `tsc` veia el `tsconfig.tsbuildinfo` al dia y no emitia nada, pero el `dist` ya estaba
   borrado. Sintoma: build exit 0 y `dist/main.js` inexistente (intermitente, muy confuso).
   Fix: `prebuild: rimraf dist tsconfig.tsbuildinfo`. Verificado con 3 builds consecutivos.

3. **El dueno (PWA Admin) no podia administrar clientes/empleados.**
   Los endpoints de gestion usaban `JwtEmpleadoGuard` (claim `tipo: empleado`), asi que el
   token de dueno (`tipo: dueno`) recibia 401. Fix: `StaffGuard`, que acepta AMBOS tipos
   verificando cada uno contra su secreto y revalidando el empleado contra la DB.
   Requirio `JwtGlobalModule` (`@Global`) para exponer `JwtService` a los guards.

### Bug de datos (no de codigo) detectado en el checklist

- Enum `EtiquetaCliente`: mi codigo usaba `RECURRENTE`; el valor real del schema es `REGULAR`.
- El test "empleado comun ve solo su sucursal" daba falso negativo con el CAJERO porque
  **el CAJERO y los 20 clientes estan en la misma sucursal (`centro`)**. Re-hecho con el
  MESERO de `norte`: DUENO 20 / CAJERO(centro) 20 / MESERO(norte) 7, coincidiendo con el SQL.

### Decision a revisar

`GET /clientes` se abrio a los roles de staff (`CAJERO/MESERO/EMPLEADO/DELIVERY`) porque el
refinamiento 5 era **inalcanzable** si solo `DUENO/ENCARGADO` podian listar. Las MUTACIONES
siguen restringidas a `DUENO` (regalar-sello, DELETE) y `DUENO/ENCARGADO` (empleados).

---

## Lote 4 — Fidelización + Carta (cerrado)

**Schema**: se agrego `TokenValidacion.sucursalId String?` + `@@index([negocioId, sucursalId])`
y la relacion inversa en `Sucursal`. Migracion `20261005205119_add_token_validacion_sucursal`
= `ADD COLUMN` nullable + `CREATE INDEX` + FK (`ON DELETE SET NULL`). Nullable a proposito:
los tokens previos no la tienen; un backfill les asigna la principal y en Fase 2 pasa a NOT NULL.

**WebSocket** (namespace `/visitas`): salas `cliente:{clienteId}`,
`sucursal:{sucursalId}:empleados` y `negocio:{negocioId}:duenos`. El empleado entra a la sala de
su sucursal; con `accesoMultiSucursal` entra a todas las del negocio.

### Bug real encontrado por el e2e

La reutilizacion del token activo **ignoraba la sucursal**: una solicitud a Norte encontraba el
token activo de Centro, lo reutilizaba y la respuesta informaba "Norte" mientras el token
apuntaba a Centro. Fix: el `findFirst` filtra tambien por `sucursalId`. Sin ese filtro el
aislamiento por sucursal era evadible pidiendo el token "equivocado".

### Hallazgo de datos (no bug): `accesoMultiSucursal`

`Maria Encargado` tiene `accesoMultiSucursal = true` en el seed, asi que su aprobacion de un
token de Norte devuelve 201 (correcto). `Juan Cajero` (false) devuelve 403. La visita se
registra siempre en la sucursal DEL TOKEN, no en la del empleado que aprueba.

### Diseño verificado

- `solicitar` resuelve la sucursal con `SucursalResolverService` (sin claim de sucursal, el
  cliente cae a la principal) y la persiste en el token.
- `aprobar`/`rechazar`/`validar` exigen acceso a la sucursal del token (403 si no).
- La transaccion marca el token con `updateMany({usado:false})` para evitar doble uso por carrera.
- Carta: `precio` es `Decimal(10,2)` en la DB y se expone como `number`; el endpoint publico
  resuelve el negocio desde el slug del tenant (`X-Tenant-Slug`) y aplica los overrides de
  `ItemCartaSucursal`. El DELETE de carta es baja logica (los pedidos lo referencian).

---

## Lote 5 — Soporte (cerrado)

**Sin migraciones nuevas**: el schema consolidado ya tenia `WebhookLog.@@unique([origen, externalId])`,
`IntegracionGoogle`, `ResenaGoogle.@@unique([negocioId, reviewId])`, `NotificacionPush`,
`NotificacionPushEmpleado` y `Negocio.placeId`. `crypto.util.ts` ya traia AES-256-GCM.

### Hueco funcional real encontrado por el e2e

El OAuth de Google **no devuelve el `locationId`**: tras conectar, `sincronizar` devolvia
`origen: "ninguno"` y la Business Profile API nunca se llamaba. Se agrego
`GET /google/ubicaciones` + `POST /google/ubicacion` para elegir la ficha.

### Decisiones

- **Sin estrategia Passport de Google**: el flujo se implementa a mano (redirect + callback) porque
  el state de un solo uso en Redis y el cifrado de tokens requieren control propio; ademas asi es
  testeable sin credenciales reales.
- **Endpoints de Google configurables por env** para poder probar callback y refresh contra un mock.
- **`web-push` real, no stub**: VAPID del `.env`; probado end-to-end contra un mock HTTPS con
  claves ECDH reales (autorizacion `vapid t=...`, payload `aes128gcm`).
- **Carta/estadisticas**: `Decimal` -> `number` en la API; dashboard con `groupBy` + `$queryRaw`
  con `date_trunc` (1 query para la serie de 7 dias, sin N+1) y cache Redis de 5 min.

---

## Fase 2 — #2.6 Pedidos (cerrado)

13 archivos nuevos + 3 ediciones (`app.module`, `push.service`, `.env.example`).
**Sin migraciones**: `Pedido`, los 3 enums y los campos de pedidos de
`ConfiguracionClub`/`ConfiguracionSucursal` ya existian.

Refinamientos aplicados: `menuActivo` (config efectiva), tipos/modos habilitados con
override por sucursal, telefono E.164, cliente logueado vs guest, JSON de items con
`{ itemId, nombre, precioBase, precioFinal, cantidad, notas?, modificadores: [], subtotal }`
(listo para #2.7), validacion de items por negocio+disponibilidad, y rate limiting
(10/hora en crear, 30/min en el link publico).

### 2 bugs reales encontrados

1. **`cancelarPedido` reusaba la tabla de transiciones del staff**, donde
   `PENDIENTE -> CANCELADO` no existe (para el staff es `-> CONFIRMADO | RECHAZADO`).
   El cliente no podia cancelar su pedido recien creado: 400. Fix: esa ruta valida
   `PENDIENTE | CONFIRMADO` explicitamente.
2. **Eventos WebSocket duplicados**: dos `.emit()` separados a salas que un mismo
   socket integra (`cliente:` + `pedido:`, y `sucursal:` + `duenos:`) entregan el
   evento dos veces. Fix: encadenar `.to(a).to(b).emit()`. **El mismo bug estaba en
   `/visitas` desde el Lote 4** y se corrigio en los dos gateways.

### Decisiones

- WebSocket a `sucursal:{sucursalId}:empleados` en vez de `negocio:{negocioId}:empleados`
  (correccion sobre el prompt: un pedido de Norte no debe sonar en Centro).
- Sin asignacion de empleado: `empleadoAsignadoId` / `modoAsignacionPedidos` son del #2.8.
- Limites de rate configurables por env para que las suites e2e no choquen con el
  propio limite (ver TROUBLESHOOTING).

