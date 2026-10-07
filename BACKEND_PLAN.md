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

---

## Fase 2 — #2.7 Modificadores + Upsell (cerrado)

22 archivos nuevos + 4 ediciones. **Sin migraciones** (`GrupoModificador`,
`OpcionModificador`, `ReglaUpsell` y `TipoModificador` ya existian).

Refinamientos: CRUD con transacciones y validaciones en el servicio, bulk-asignar
(con `reemplazar`), upsell con los 4 limites + `sucursalId` opcional, validacion de
modificadores en `POST /pedidos`, cache Redis con invalidacion (10 min grupos /
5 min reglas), auditoria de las 6 acciones, aislamiento multitenant.

### Bug real encontrado

`updateMany` **no acepta operaciones de relacion**: el `disconnect` en el borrado de
un grupo asignado fallaba. Reemplazado por un `update` por item en la transaccion.

### Cambio de contrato respecto de #2.6

`ItemPedidoInputDto.modificadores` paso de `{ grupoId, opcionId }` a
`{ grupoId, opcionIds: string[] }` (necesario para MULTIPLE_SELECCION) y
`ModificadorElegido.precio` se renombro a `precioExtra`.

### Decisiones

- Eliminar un grupo asignado exige `force=true` SIEMPRE (mas seguro que la condicion
  del prompt, que solo lo pedia si el grupo era obligatorio).
- `@IsString()` en vez de `@IsUUID()`: los IDs son cuid (ver TROUBLESHOOTING).
- Rate limits del upsell configurables por env, igual que en pedidos.

---

## Fase 2 — #2.8 Turnos + Asignacion (cerrado)

15 archivos nuevos + 5 ediciones. **Sin migraciones**: `Turno`, `EncargadoDia`,
`CheckinTurno`, `TipoTurno` y `ModoAsignacionPedidos` ya existian.

Refinamientos aplicados: reuso de `SucursalResolverService` y `WsJwtGuard`; CRUD con
validacion de solapamiento; vista semanal cacheada (TTL 10 min); encargado del dia
unico por sucursal (TTL 1 h); check-in/out idempotente; los 4 crons; los 3 modos de
asignacion con sus fallbacks; `PATCH /pedidos/:id/tomar` atomico; WS a
`empleado:{id}` con fallback; `@IsString()` en los IDs (cuid).

### Bug/gap real encontrado

`emitirPedidoNuevo` en la sala individual dejaba afuera a `negocio:{id}:duenos`:
la PWA Admin dejaba de ver los pedidos entrantes en vivo. Detectado por el test de
WS que esperaba al dueno entre los destinatarios.

### Decisiones

- `AsignacionPedidosService` **solo calcula** (no emite ni conoce el gateway):
  `TurnosModule` no importa `PedidosModule` y no hace falta `forwardRef`.
- Turnos que cruzan medianoche soportados en la validacion, el solapamiento y el
  "quien esta en turno ahora".
- El fallback de `checkinObligatorio=true` sin nadie con check-in notifica a los
  programados: prefiero avisar de mas que dejar un pedido sin atender.
- El detalle de la asignacion no se devuelve desde `POST /pedidos` (endpoint
  publico): va a auditoria.

---

## Fase 2 — #2.9 Gating por plan, limites y colchon de gracia (cerrado)

12 archivos nuevos + ediciones en 9 controladores y 5 servicios. **Sin migraciones**:
`PlanFeature`, `UsoMensual`, `RecursoLimitado`, `EstadoUso` y `Suscripcion` ya
existian, y el seed ya carga las 19 features de los 3 planes.

### Dos dimensiones en la MISMA tabla

`PlanFeature.feature` guarda las banderas booleanas (`menu`, `turnos`, `upsell`...) y
las 6 cuotas numericas (`clientes`, `empleados`, `sucursales`, `items_carta`,
`pedidos_mes`, `campanas_push_mes`). El mapeo `RecursoLimitado -> feature` es 1:1 con
el enum en minusculas: no hace falta tabla intermedia.

### Colchon = USOS ABSOLUTOS

`limiteGracia = limiteBase + colchonGraciaDefault (50)`.
NORMAL <= 100% | ADVERTENCIA <= gracia | EXCEDIDO > gracia.
Con `clientes` de BASIC (500) la gracia es 550, no 750: el "150%" del prompt es
ilustrativo del caso de limite 100.

### Decisiones (confirmadas por el usuario)

- **Super-admin**: los 3 endpoints NO se hacen ahora (el modulo es el #9). Quedan los
  metodos `PlanService.actualizarFeature / setPayPerUse` y
  `UsoMensualService.resetearUsoMensual` para que el #9 solo cablee los controllers
  con su `SuperAdminGuard`. No se exponen sin auth.
- **Email**: no hay proveedor en el monorepo. Se hace push + `EventoAuditoria`, y el
  evento guarda `asunto`, `cuerpo`, `feature`, `periodo` y `umbral` para que el #32
  (Resend) pueda mandarlos retroactivamente.
- `verificarLimite` NO incrementa; el `incrementarUso` va DESPUES de escribir.
- El fallback de una feature inexistente **niega** (no abre la puerta).

### Bugs reales encontrados

1. **`HttpExceptionFilter` descartaba los campos propios** del payload: un 403 con
   `recurso/estado/limiteBase/limiteGracia` llegaba solo con `message`, y encima
   rotulado `"error": "InternalServerError"`. Arreglado (afecta a TODOS los modulos).
2. **`@IsInt()` sobre query params** sin `@Type(() => Number)`:
   `GET /planes/uso-mensual/historico?meses=6` daba 400.
3. **`plan.feature_actualizada` no se auditaba** sin negocio y el error se perdia en
   silencio (`EventoAuditoria.negocioId` es obligatorio).
4. **`CAMPANAS_PUSH_MES` desincronizado**: la reconciliacion contaba
   `CampanaMarketing` pero `enviarPromocion` no creaba la fila.

### Pendiente para el #2.10

**No existe `SucursalService.crear`** (la carpeta `sucursales/` solo tiene el
resolver), asi que el limite `SUCURSALES` todavia no tiene donde engancharse. El
`LimitesService` ya lo soporta: el #2.10 solo agrega la llamada al crear sucursales.

---

## Fase 2 — #2.10 CRUD de Sucursales (cerrado)

14 archivos nuevos + ediciones en `sucursales.module`, `staff.guard`,
`configuracion.service` (export de `CAMPOS_OVERRIDE`) y `redis.service`
(`delByPattern`). **Sin migraciones**.

### Decisiones confirmadas

- **Sin duplicar el merge**: `configuracion-sucursal.service` valida y escribe el
  override, y delega la resolucion en el `configEfectiva` existente (fuente unica).
- **Sin migracion de backfill**: no habia huerfanos (10/10 tokens con `sucursalId`).
  El metodo y el comando one-shot quedan para produccion, documentados en el README.
- Bulk de `ItemCartaSucursal` con `$transaction`: un item invalido no deja nada a
  medias.
- `GET /sucursales/mis-sucursales` con alcance por rol (lo consume la PWA Staff #4.7).
- `EliminarSucursalDto.force` reasigna empleados a la principal y cancela los pedidos
  en curso, todo en una transaccion.

### Bugs reales encontrados

1. **`resolver.invalidar()` era un NO-OP** (ver TROUBLESHOOTING). El cache de
   resolucion quedaba viejo hasta 5 min tras cualquier cambio de sucursal. Fix:
   `RedisService.delByPattern()` con SCAN.
2. **Query params booleanos**: `?force=true` daba 400 y `@Type(() => Boolean)`
   convertia `"false"` en `true`. Fix: helper `QueryBool()`.

### Colchon de gracia: cambiado a PROPORCIONAL con tope

`limiteGracia = limiteBase + min(colchonGraciaDefault, ceil(limiteBase * 0.5))`.
Antes era en usos absolutos y con limites chicos dejaba el gating decorativo
(FREE `sucursales: 1` permitia 51). Ahora: `1->2 | 100->150 | 500->550 | 5000->5050`.
Formula centralizada en `plan.service` y usada en los 3 puntos que la necesitan.

### Pendiente para el #2.11

`SucursalService` recien ahora existe, asi que el #2.11 (auditoria multi-sucursal)
puede verificar que `sucursales` tambien filtra por sucursal y que `UsoMensual`
no quedo con contadores huerfanos (la reconciliacion semanal los corrige).

---

## Google Reviews API — DIFERIDA (no bloqueante)

**Google Reviews API: diferida hasta tener GBP verificado o un cliente con GBP que
nos de acceso. El fallback con `placeId` funciona desde ya.**

El producto lanza con el fallback de `placeId` (funcional hoy: `GET /resenas` publico
con `TenantGuard`, cacheado 5 min, y `GET /resenas/admin` con filtros). La API
completa de Business Profile queda como "nice to have" para cuando:
- haya un cliente con GBP verificado que otorgue acceso admin, o
- Clubio cumpla los 60 dias que pide Google para ese acceso.

---

## Fase 2 — #2.11 Refactor multi-sucursal (CERRADO)

### Auditoria inicial (evidencia, no checklist)

```text
visitas        34 refs sucursalId + resolver OK     pedidos   32 + resolver OK
turnos/checkin 84 + resolver OK                     carta      4 + resolver OK
clientes       16 + resolver OK                     config     8 + resolver OK
upsell           7 + resolver OK                    empleados 12 (filtra por rol)
estadisticas    11 refs                             push       4 refs
modificadores / resenas / negocios: sin sucursalId (correcto por diseno)
WS: visitas.gateway 4 emits a sala de sucursal | pedidos.gateway 12/13
modoClientes GLOBAL vs POR_SUCURSAL: implementado en clientes, visitas y pedidos
TarjetaClienteSucursal: visitas (tx), clientes (upsert), pedidos (lectura)
```

### Gaps encontrados y cerrados

1. **`numeroAtendiente` ignoraba la sucursal**: `asignacion-pedidos.service` leia solo
   `ConfiguracionClub.numeroAtendiente`. Ahora usa
   `resolverNumeroAtendiente()` (sucursal -> club -> null), respetando
   `usarNumeroAtendienteDistinto`.
2. **Al resolver le faltaban 2 fuentes y 3 metodos**: se agrego `clienteId` (fuente 4,
   solo con `modoClientes = POR_SUCURSAL`: la `TarjetaClienteSucursal` mas reciente),
   `resolverSucursalDePedido`, `resolverNumeroAtendiente` y la invalidacion del cache
   de config.
3. **El alta PUBLICA de cliente no creaba `TarjetaClienteSucursal`** (solo el alta
   manual del staff). Con `POR_SUCURSAL` un cliente que se registraba solo quedaba sin
   tarjeta. Ahora se resuelve la sucursal del QR y se le crea.
4. **El JWT del cliente no llevaba `sucursalId`** (punto 12 del prompt). Ahora se
   agrega solo con `modoClientes = POR_SUCURSAL`.
5. **`GET /negocios/publico/:slug` no aceptaba `?sucursalSlug`**: ahora devuelve la
   config EFECTIVA de esa sucursal, `sucursalActiva` y el `numeroAtendiente` resuelto.
6. **`configEfectiva` pegaba 2 queries por request**: se agrego
   `configEfectivaCacheada()` (TTL 5 min) con invalidacion al tocar el club, el
   override de una sucursal, o al cambiar/eliminar la sucursal.

### Decisiones

- `resolverConfiguracionEfectiva` **no** se implemento en el resolver (seria un ciclo
  de providers con `ConfiguracionService`): la version cacheada vive en
  `ConfiguracionService`.
- Los WebSockets ya emitian a salas por sucursal: no se tocaron, solo se verifican.

### Bug real encontrado en el propio refactor

El JWT del cliente se firmaba con `sucursalId` **siempre**, aunque el negocio fuera
GLOBAL. Corregido para que el claim aparezca solo con `POR_SUCURSAL`.

### Verificacion final del #2.11

**1) Sellos GLOBAL vs POR_SUCURSAL (e2e con visita real)** — encontro un bug real
(invertido, ver TROUBLESHOOTING). Ya corregido:

```
GLOBAL        -> Cliente 0->1 Y Tarjeta(centro) 0->1, Tarjeta(norte) no existe
POR_SUCURSAL  -> Cliente sigue en 0, Tarjeta(centro) 0->1
premio        -> POR_SUCURSAL con cliente=99 y tarjeta=1 -> premio FALSE (mide la tarjeta);
                 la 2da en la misma sucursal -> premio TRUE con el cliente en 99
independencia -> aprobar en NORTE: centro 2->2, norte 0->1
```

**2) Aislamiento de WebSocket en /visitas (e2e con sockets reales)**:

```
salas: Pedro(norte) [sucursal:norte] | Juan(centro) [sucursal:centro]
       Maria(multi) [sucursal:centro, sucursal:norte]
       Carlos(dueno,multi) [centro, norte, DUENOS] | Cliente A [cliente:A]

solicitud en NORTE -> Pedro 1 | Juan 0 | Maria 1 | Carlos 1 | ClienteA 0 | ClienteB 0
  (Maria y Carlos estan en las 2 salas y reciben UNA sola vez: emision encadenada)
aprobacion -> visita:aprobada solo al Cliente A (B: 0)
inverso: solicitud en el negocio B -> NADIE de A la recibe (0 en los 4 + ClienteA 0)
```

**3) `pnpm --filter backend test:checklist`** — script ejecutable
(`apps/backend/scripts/checklist-multisucursal.js`): 16 modulos, tabla con
modulo/estado/resolver/filtro/nota y exit 1 si falla. Auto-verificado inyectando dos
violaciones (un broadcast sin sala y un `sucursalId` hardcodeado): el script las
detecta y sale con 1.

### Bug de infraestructura encontrado en la verificacion

`pnpm start:dev` **no arrancaba**: `nest start --watch` reportaba "Found 0 errors" y
moria con `Cannot find module dist\main`, por el `incremental: true` + tsbuildinfo
al dia (el mismo problema que `build` ya tenia resuelto). Se agregaron `prestart` y
`prestart:dev` con `rimraf dist tsconfig.tsbuildinfo`.

## #3.0 — Soporte de backend para la PWA Cliente (CERRADO)

Implementado antes de escribir una linea de PWA, porque el backend tenia el lado
cliente practicamente vacio: solo `registrar` y `recuperar`.

**A) Cookie HttpOnly** (`common/utils/cookie.util.ts`): `registrar`/`recuperar`
setean `cliente_token` (HttpOnly, SameSite=None+Secure en produccion, Lax sin Secure
en desarrollo); `logout` la borra. La estrategia `jwt-cliente` la acepta como
extractor ademas del `Authorization: Bearer`, y el gateway recibe el token por
`auth.token`, `?token=`, `Authorization` o cookie.

**E) `urlValidacion`** sale de `STAFF_APP_URL` (antes hardcodeado a
`staff.dominio.com`).

**F) `features` del plan** en `GET /negocios/publico/:slug` (via `PlanService`, con
su cache de 10 min) para el gating visual: PRO devuelve 19 features, FREE devuelve
`['fidelizacion','resenas','clientes','empleados','sucursales']` y **no** `menu`.

**G) `GET /modificadores/items/:itemId/grupos`** publico, en un controller aparte
(el de staff tiene los guards a nivel de clase). Devuelve grupos + opciones con
`precioExtra`; 404 si el item no existe o no esta disponible; 400 sin tenant.

**H) `GET /visitas/estado/:token`** (cliente): `PENDIENTE | APROBADA | RECHAZADA |
EXPIRADA` + sellos y `mostrarResena`. Un token de otro cliente da 404, igual que uno
inexistente.

**I) `GET /visitas/mi-tarjeta` y `GET /visitas/mi-historial`** (cliente), con
`?sucursalSlug=` opcional.

**J) Push del cliente**: ya existia como `POST /push/suscribir` con
`JwtClienteGuard` + `@RequiereFeature('push')` — no se duplico como
`suscribir-cliente`.

### Bugs reales encontrados y corregidos en el camino

- **`mostrarResena` hardcodeado en `true`**: el dueño apagaba las resenas en la
  configuracion y la PWA las mostraba igual.
- **`urlValidacion` hardcodeado** a un dominio de ejemplo.
- **`@repo/api-client` no compilaba** (14 backticks escapados) y su `createSocket`
  mandaba `auth: { Authorization }`, una clave que el gateway **no lee**: el
  WebSocket nunca se habria autenticado. Se agrego `setToken`/`setTenant`, se
  corrigio el mapa `endpoints` (tenia rutas inexistentes) y se ajusto al
  `exactOptionalPropertyTypes` de los packages.

### Verificacion (todo con salida real)

```
cookie:   Set-Cookie: cliente_token=<jwt>; Max-Age=2592000; Path=/;
          Expires=...; HttpOnly; SameSite=Lax     (dev: sin Secure)
          me con cookie -> 200 | sin cookie -> 401 | Bearer -> 200
          cookie + tenant AJENO -> 403 (TenantGuard) | logout -> Max-Age=0
ws:       A con cookie conecta y RECIBE visita:aprobada (entro a cliente:{A}); B no
          sin cookie -> error "No autenticado" + disconnect
estado:   PENDIENTE -> APROBADA (sellos 1) -> RECHAZADA con motivo ("QR ya usado")
          expirado -> EXPIRADA | token de otro cliente -> 404
tarjeta:  sucursal, modo, sellos/de, premioTexto, faltantes, tarjetas[]
historial: total y filas con tipo/sellos/empleado/sucursal
modif.:   200 publico con "Punto de coccion" -> [Jugoso, A punto, Cocido]
```

### Bug extra encontrado en la verificacion final

`GET /sucursales/publico` respondia **401**: estaba en `SucursalesController`, que
tiene `@UseGuards(StaffGuard, TenantGuard, RolesGuard)` a nivel de CLASE, asi que su
`@Public()` no lo salvaba (misma trampa que los modificadores). Movido a
`SucursalesPublicoController`. Verificado: 200 sin auth, 400 sin tenant, 404 con
tenant inexistente, y `/sucursales/mis-sucursales` sigue dando 401 sin token.

## TODO (deuda tecnica anotada)

1. **`@repo/validators`: migrar las listas `as const` a `z.nativeEnum()`** cuando se haga
   **Project References** en el monorepo. Hoy no se puede: importar `@repo/types` desde el
   package mete sus fuentes en el programa de `tsc` y rompe con TS6059 (`rootDir`), que es
   justamente lo que Project References resuelve (consumir `dist` + `references`).
   Los enums de `@repo/types` ya son `export enum` de runtime, asi que `z.nativeEnum`
   funcionara sin cambios del lado de los tipos.
2. **`@repo/utils`: su `build` sigue fallando por `rootDir`** (importa `@repo/types` como
   valor, para los miembros del enum). El `typecheck` ya es verde con `--rootDir ../..`.
   Se cierra con el mismo Project References del punto 1.
3. **Alinear el resto de los schemas de `@repo/validators` con sus DTOs** (DESPUES del
   QR #1: no es bloqueante para el menu/carrito, que valida contra la API real): se revisaron los
   enums, pero las FORMAS de los campos tambien divergen. `registrarClienteSchema` no tiene
   `negocioSlug` (que la API exige) y tiene `email`/`fechaNacimiento` que
   `RegistrarClienteDto` no acepta. Hay que revisar los 21 esquemas contra
   `apps/backend/src/**/dto/*.dto.ts`.

## TODO antes de la demo con un cliente real

### TODO: contrasena de Neon

La contrasena del rol `admin_role` de Neon **ya fue rotada** (quedo expuesta en el historial de una
sesion de trabajo). Para el deploy se usa la del `.env`; si se vuelve a exponer, rotarla en Neon y
actualizar `DATABASE_URL` + `DIRECT_URL` (el pooler y el directo usan la misma credencial con host
distinto).


### TODO pre-demo: limpiar los datos de prueba

Los harnesses de integracion (`check-auth-staff`, `check-flujo-ws`) **crean datos reales** en la DB de
desarrollo: clientes con telefonos `+5493585...`, pedidos de todos los tipos y visitas aprobadas/
rechazadas. Antes de una demo hay que limpiar clientes/pedidos/visitas de prueba (y el `seed.ts` resync).


### TODO pre-demo: `GET /pedidos/:id/historial` o dejarlo con timestamps

Hoy el detalle del pedido muestra un timeline con los **timestamps del modelo**
(`creadoEn -> confirmadoEn -> enviadoEn -> entregadoEn`). Lo que NO hay es la LISTA de
transiciones (quien cambio a que y cuando): la auditoria se registra en `Auditoria`
(`pedido.<estado>`), pero no se expone por endpoint.

Decision pendiente: agregar `GET /pedidos/:id/historial` (leyendo `Auditoria` con
`detalle.pedidoId`) o quedarse con los timestamps, que cubren el caso normal. Nota: el
modelo **no tiene `enPreparacionEn`**, asi que el paso "en preparacion" no tiene hora
propia; solo se ve por el estado actual.

### REGLA: cancelar un pedido es de CLIENTE; el staff usa PATCH /:id/estado

`PATCH /pedidos/:id/cancelar` esta detras de `JwtClienteGuard`: es el cliente quien cancela
su propio pedido. El staff NO puede usar ese endpoint: cancela con
`PATCH /pedidos/:id/estado { estado: 'CANCELADO' }`, y solo desde CONFIRMADO o
EN_PREPARACION. Un pedido PENDIENTE se RECHAZA (con motivo >= 10 caracteres), no se cancela.


### TODO pre-PWA-Admin: auditar TODOS los stubs de `@repo/ui`

"Auditar TODOS los stubs de @repo/ui antes de usar el componente en otra PWA. Lista actual: dialog,
alert-dialog, accordion, select, sheet, dropdown-menu."

Verificacion: `grep -l crearStub packages/ui/src/components/*.tsx`. Los stubs compilan, importan sin
error y fallan en runtime **sin warning de Next**: el sintoma es un modal que no abre o un control sin
estilo, no un crash.

### REGLA DE NEGOCIO: una visita aprobada bloquea otra solicitud el mismo dia

"Despues de visita APROBADA -> el cliente no puede solicitar otra ese dia. Despues de RECHAZADA -> si
puede. Es intencional (anti-fraude). No es bug."

Verificado de punta a punta (Fase 2 de la PWA Staff): con el token aprobado, `POST /visitas/solicitar`
del mismo cliente no devuelve token; con el token rechazado, si lo devuelve. No "arreglarlo".


### TODO pre-deploy: `configuracion.turnosActivos` (default `false`)

- La tab **Turnos** de la PWA Staff solo aparece si `tieneFeature('turnos')` **y** `configuracion.turnosActivos`.
- Se configura desde la PWA Admin.
- Migracion chica (1 campo en `ConfiguracionClub`), con default `false` para que los negocios existentes no
  cambien de comportamiento.
- Motivo: hoy la Fase 4 (turnos/check-in) esta postergada "segun demanda", pero la tab ya esta en el
  BottomNav. Sin el flag, todos los locales ven una tab vacia.


- [ ] Limpiar clientes de prueba antes de la demo con cliente real. Los `e2e_s3/e2e_s4`
  y el harness de visitas registran clientes en el tenant demo (hoy: 34 total, 20 del seed
  + 14 de tests). Borrarlos con un script especifico, revisando que no tengan pedidos ni
  visitas asociadas.
- [ ] Regenerar los 6 secretos JWT y los placeholders `Tu nombre` / `UNLICENSED` del
  `apps/backend/package.json`.
- [ ] `e2e_s4.cjs` borra TODOS los overrides de la sucursal norte
  (`itemCartaSucursal.deleteMany({where:{sucursalId: norte.id}})`), no solo los que crea el
  test. Cuando el e2e crezca, marcar los suyos (por id o por un prefijo) para no arrastrar los
  del seed.
- [ ] TODO pre-deploy: sincronizar `seed.ts` con grupos agregados por scripts
  (salsas obligatorias). Hacer cuando se corra `pnpm db:reset` en staging antes del
  deploy. Verificar con base limpia.

## Hallazgos de la revision visual (etapa 3)

- [ ] **BUG (bloqueante para el QR #2)**: el mensaje de WhatsApp de la visita sale generico
  ("Hola, quiero sumar mi visita en Bar La Esquina") y **no incluye el token**. Esperado:
  `"Hola, soy [nombre]. Quiero sumar mi visita en [negocio]. Ref: [token]. Validar aqui: [urlValidacion]"`.
  A verificar: (a) si `POST /visitas/solicitar` devuelve un `mensajeWhatsApp` que ya trae el
  token, (b) si la PWA lo ignora y arma el suyo. Archivos a mirar: `components/flujo/PasoEspera.tsx`
  y `lib/visita-service.ts` (no existe un `EsperandoValidacion.tsx` en este repo: los pasos del
  QR #2 se llaman `PasoRegistro/PasoEspera/PasoConfirmado/PasoNoSumada`).
- [ ] **No bloqueante**: `brandingStore` persiste campos mutables (`numeroAtendiente`) en
  localStorage. Deberia persistir solo `slug` + `id` y refetchear el resto con TTL de 5 min
  (mismo patron que `carta-cache`).

## TODO etapa 4 (post-checkout)

- **TODO etapa 4 post-checkout: implementar `/tarjeta` real** (TarjetaSellos con data del cliente +
  historial de visitas + boton de resena si `premioDesbloqueado`). Hoy `/tarjeta` es el placeholder
  del esqueleto y la tab del BottomNav ya apunta ahi, asi que el hueco se ve.

### TODO auditoria de `@repo/ui` (menor, no bloqueante)

- Warning en consola: **"NaN is an invalid value for opacity"** en `bottom-sheet.tsx:31`. Revisar
  cuando se audite `@repo/ui` (junto con los stubs de RadioGroup/Checkbox/Textarea). No rompe nada:
  es un valor de opacidad que sale `NaN` en vez de un numero.

## TODO deuda tecnica: guard de rutas en el ApiClient

- **TODO `@repo/api-client`: que `ApiClient.request()` tire error en development si el path no
  empieza con `/api/`.** Hoy dos bugs de la misma clase (ruta handcodeada sin el prefijo) se
  cazaron recien en el celular, y uno de ellos se disfrazo de "el modal no abre" por el loop de
  reintentos. Con el guard, la primera llamada rompe en desarrollo y el bug no llega al celular.
  Requiere tocar `packages/api-client` (avisar antes).

## TODO post-etapa 4 (menores)

- **`ErrorCarrito.codigo` es `string` con el union en un comentario.** Pasarlo a union real
  (`'RATE_LIMIT' | 'VALIDACION' | 'SUCURSAL_CERRADA' | 'CARTA_VENCIDA' | 'RED' | 'DESCONOCIDO'`) para
  que el compilador valide. Toca consumidores, por eso va aparte.

## TODO checkout: riesgo residual de la guarda por sucursal

- **Riesgo residual: si un negocio no tiene sucursales, `activa` queda en `null` para siempre y
  `/checkout` muestra "Cargando..." indefinidamente.** El redirect por carrito vacio ahora espera a
  que la sucursal viva este resuelta (`puedeDecidir = locale && sucursalId !== null`), asi que si esa
  resolucion nunca llega, la pantalla se queda cargando en vez de mandar al menu.
  Fix propuesto: flag `resolviendo` en `SucursalProvider` (query -> storage -> fallback ->
  `resolviendo = false`), y que el checkout espere a `!resolviendo` en lugar de a una sucursal no
  nula. **Evaluar cuando se agregue el primer negocio sin sucursales** (hoy `bar-la-esquina` tiene
  dos y resuelve siempre).

## TODO post-MVP: numero de pedido real

El modelo `Pedido` **no tiene** `numero`. Lo unico parecido es `numeroAtendiente`, que sale de
`resolverNumeroAtendiente(negocioId, sucursalId)`: es el numero del *atendiente* (config del negocio
por sucursal, `actualizar-configuracion.dto`), no un identificador de pedido, y en la demo trae un
telefono. Por eso la pantalla de seguimiento titula "Tu pedido" y no "Pedido #X".

Post-MVP: agregar `numero` a `Pedido` (correlativo por negocio o por sucursal, con su migracion) para
poder mostrar "Pedido #N" en el seguimiento y en la comanda. **No hacerlo antes.**

## TODOs de deploy (Fase 3 cerrada)

### TODO Fase 4: confirmar el "No hay items disponibles" en /bar-la-esquina/menu

Medido con los dominios reales: `GET /api/carta` **con** `X-Tenant-Slug: bar-la-esquina` devuelve 200
con negocio + sucursal (centro), y **sin** el header devuelve 404 "Negocio no encontrado". Pero el HTML
servido de `/bar-la-esquina/menu` (200, ~15 KB, con el branding correcto y sin localhost ni LAN IP)
dice "No hay items disponibles en esta sucursal".

Hipotesis: el fetch de la carta en el render de servidor no manda el header del tenant (y la app cae en
su empty state), mientras que el de branding si. **No es del deploy** (el problema existia antes de que
hubiera deploys). Hay que confirmarlo en el navegador, con el menu cargando en pantalla: si con la
sucursal activa los items aparecen, es estado client-side; si no, es el SSR sin header.

### TODO pre-onboarding: staff.clubio.lat tiene que estar vivo antes del primer local

`STAFF_APP_URL=https://staff.clubio.lat` (verificado en Railway). Ese link es el que recibe el staff en
el mensaje de WhatsApp cuando hay una visita para aprobar (`/validar?ref=TOKEN`). Si el dominio no
responde, el local se queda sin poder aprobar visitas: **onboardear un local implica que
staff.clubio.lat ya este arriba**, no despues.

### Infra de produccion (referencia rapida)

- Backend: `https://api.clubio.lat` → `backend-production-8ebe8.up.railway.app` (servicio `backend`).
- Cliente: `https://app.clubio.lat` → `clubio-cliente-production.up.railway.app` (Dockerfile propio).
- Staff:   `https://staff.clubio.lat` → `clubio-staff-production.up.railway.app` (Dockerfile propio).
- Los 3 CNAME en Cloudflare arrancaron DNS-only para que Railway verificara la cadena (los 3 pasaron en
  ~31-33 s, con un TXT `_railway-verify.<sub>` por dominio) y despues se pasaron a proxied (SSL del
  zone en `full`).
- `CORS_ORIGINS` incluye app/staff.clubio.lat + los 2 origenes `.up.railway.app` (las PWAs llaman a la
  API por la URL de Railway, no por api.clubio.lat; cambiar eso exige rebuild de las PWAs).

### TODO opcional post-MVP: SSR de la carta renderiza empty state; el cliente rellena por useEffect

Verificado en browser real (perfil limpio, sin cookies) contra `https://app.clubio.lat/bar-la-esquina/menu`:
la carta se ve COMPLETA (Milanesa $6.800, Coca-Cola $1.500, 13 precios), sin el empty state.

El mecanismo, medido con las requests de la propia pagina:
- El render de servidor pide `GET /api/carta` **sin** `sucursalSlug`, y la API no puede filtrar: devuelve
  el empty state "No hay items disponibles en esta sucursal".
- Al hidratar, el cliente vuelve a pedir `GET /api/carta?sucursalSlug=centro` y ahi si llegan los items
  (mas `POST /api/upsell/calcular`).

Impacto: SEO + first paint (el HTML inicial muestra "no hay items" y se corrige ~1 s despues).
**No bloqueante.** No es un bug de fetch ni falta el header del tenant: la diferencia es el
`sucursalSlug`, que en SSR todavia no se conoce.

