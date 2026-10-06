# Troubleshooting

Errores conocidos del monorepo y sus soluciones.

---

## REGLA #0 (antes de reportar un error)

### Un error puede venir de un proceso VIEJO: verificar que quien lo emite es el actual

Ya paso dos veces en este proyecto: un server arrancado ANTES de la edicion escuchando en
:3000 hizo que los tests de sellos corrieran contra codigo viejo, y un `next dev` viejo en
:3001 habria hecho lo mismo con la PWA.

Protocolo, en orden:

1. Verificar que el proceso que emite el error es el ACTUAL.
2. Matar los procesos en background (`taskkill /F /PID <pid>`; en este bash `taskkill //F`
   NO funciona, y para un arbol entero hace falta `/T`).
3. Verificar que el puerto este libre (`netstat -ano | grep -E ":3000|:3001"`).
4. Correr build + typecheck en arbol limpio.
5. Si el error persiste, es real. Si no, era obsoleto.

Corolario util: las notificaciones de procesos en background pueden llegar TARDE y
describir una corrida ya superada. Antes de reportar, mirar si el estado actual coincide
con lo que dice la notificacion.

### `prisma generate` falla con EPERM si el backend esta levantado (Windows)

```
EPERM: operation not permitted, rename '...\query_engine-windows.dll.node.tmp17104'
  -> '...\query_engine-windows.dll.node'
```

El server tiene abierta la DLL del query engine y Windows no deja reemplazarla. No es un
problema de Prisma ni de dotenv: **hay que bajar el server antes de `prisma generate`**
(verificado: con el server abajo, `db:generate` sale exit 0).


## REGLA #1

### El build NO valida el grafo de dependencias: hay que ARRANCAR el server

`pnpm build` sale con exit 0 y `lint` tambien, pero si un modulo no importa el modulo
dueño de un provider, la aplicacion **no arranca**:

```
Nest can't resolve dependencies of the NegociosService (..., ?, ...).
Please make sure that the argument ConfiguracionService at index [1] is available
in the NegociosModule context.
```

Es un error de RUNTIME, no de compilacion: tsc no ve el grafo de DI. Despues de
cualquier cambio de modulos hay que **levantar el server y pegarle a `/api/health`**
(no alcanza con build + lint).

Relacionada: un `error TS` no es la unica forma en que falla `build`. Mirar SIEMPRE el
exit code, no un grep de "error TS" (ver Fase 2 — Gating por plan).

## Bug: seedUsoMensual con upsert de clave compuesta nullable

El upsert de UsoMensual usa la clave compuesta
(negocioId, sucursalId, recurso, periodo). Prisma no acepta
que sucursalId sea null en la clave compuesta para el upsert.

Solución: usar create() después de un findFirst() manual,
o usar un valor por defecto (ej: 'global') en lugar de null.

## Redis con Upstash (TLS)

Upstash exige TLS. Si BullModule o el Throttler fallan con `TLS error`,
`Connection closed` o `ECONNRESET`, ajustar `BullModule.forRoot()`:

```ts
BullModule.forRoot({
  redis: process.env.REDIS_URL,
  // Upstash requiere TLS
  // Si falla con "TLS error", agregar:
  // tls: { rejectUnauthorized: false },
  // enableReadyCheck: false,
  // maxRetriesPerRequest: null,
})
```

Notas:
- `REDIS_URL` debe ser `rediss://` (con doble s), no `redis://`.
- `maxRetriesPerRequest: null` es **obligatorio** para BullMQ (si no, lanza al arrancar).
- `enableReadyCheck: false` evita el ready-check que falla contra Upstash.

## ENCRYPTION_KEY: 32 bytes exactos

`crypto.util.ts` cifra los tokens de Google con AES-256-GCM, que exige una clave de
**32 bytes**. El error típico es confundir bytes con caracteres:

```ts
// ❌ INVALIDO: una clave hex de 64 chars mide 64 bytes como string
Buffer.byteLength(ENCRYPTION_KEY, 'utf8') !== 32   // 64 !== 32 -> siempre falla

// ✅ CORRECTO: decodificar hex y validar los 32 bytes resultantes
const key = Buffer.from(ENCRYPTION_KEY, 'hex');
if (key.length !== 32) throw new Error(...)
```

Generar la clave:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Formatos aceptados por `crypto.util.ts`:
- 64 chars **hex** (decodifica a 32 bytes) ← recomendado
- 32 chars crudos (32 bytes ASCII)

Si la validación falla, el error incluye el comando exacto para regenerarla.
Guardar el valor en `.env` (ignorado) y en `.env.secrets`.

## Refresh token determinístico rompe la rotación (anti-replay)

`jwt.sign({ sub, negocioId, tipo: 'refresh' }, { secret, expiresIn })` produce el **mismo
string** si se firma dentro del mismo segundo (mismo `iat`). Consecuencia: al rotar, el token
"nuevo" es **idéntico** al viejo, así que el replay del token anterior sigue siendo válido y la
rotación no invalida nada.

Fix: agregar un `jti` único al payload.

```ts
import { randomUUID } from 'crypto';
this.jwt.sign({ ...payload, jti: randomUUID() }, { secret, expiresIn });
```

Detectado por el test e2e: el segundo uso del mismo refresh devolvía `201` en vez de `401`.

## Secretos JWT: deben ser 6 distintos

Si `JWT_EMPLEADO_SECRET`, `JWT_DUENO_SECRET`, `JWT_CLIENTE_SECRET`, `JWT_REFRESH_SECRET` y
`JWT_SUPER_ADMIN_SECRET` comparten valor, un token de cliente **verifica** correctamente contra
un endpoint de dueño: la firma es válida y lo único que frena el acceso es el claim `tipo`.
Eso convierte al claim `tipo` en la **única** barrera en lugar de defensa en profundidad.

Generarlos (uno por contexto, todos distintos):
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

En `apps/backend`, `requireEnv()` lanza si falta un secreto cuando `NODE_ENV=production`;
los fallbacks `dev-*-solo-desarrollo` solo aplican en desarrollo.

---

## Lote 5 — Soporte (push, Google, resenas, estadisticas, webhooks)

### BullMQ + Upstash: opciones OBLIGATORIAS

`BullModule.forRoot()` arma la conexion desde `REDIS_URL` (ver `app.module.ts`). Upstash necesita:

- `tls: { rejectUnauthorized: false }` cuando la URL es `rediss://` (si no: "TLS error").
- `enableReadyCheck: false` (Upstash no responde el ready-check como un Redis local).
- `maxRetriesPerRequest: null` — **obligatorio en BullMQ**: con otro valor, el worker lanza
  `maxRetriesPerRequest must be null` al arrancar.

### Web Push: el endpoint de prueba tiene que ser HTTPS

`web-push` **siempre** habla TLS: si se apunta `endpoint` a un `http://` local, el error es

```
write EPROTO ... ssl
ecord\methods	lsany_meth.c:78: wrong version number
```

No es un bug del codigo. Para probar el envio real sin FCM hay que levantar un mock **HTTPS**
(cert autofirmado) y arrancar el backend con `NODE_TLS_REJECT_UNAUTHORIZED=0` **solo en el test**.

Los codigos 404/410 significan que el navegador revoco la suscripcion: se desactiva
(`activa = false`) y NO se reintenta, porque es un fallo permanente.

### Google OAuth: el callback NO devuelve el locationId

El intercambio de codigo solo da `access_token` + `refresh_token`. La ubicacion de cuya ficha
se leen las resenas hay que elegirla aparte:

1. `GET /api/google/ubicaciones` (descubre cuentas y ubicaciones)
2. `POST /api/google/ubicacion` con `{ accountId, locationId }`

Sin ese paso, `sincronizar` devuelve `origen: "ninguno"` y no importa ninguna resena.

Los endpoints de Google son sobrescribibles por env (`GOOGLE_OAUTH_AUTH_URL`,
`GOOGLE_OAUTH_TOKEN_URL`, `GOOGLE_GBP_API_URL`, `GOOGLE_PLACES_URL`) para poder probar el flujo
completo contra un mock sin credenciales reales.

### Webhooks: idempotencia por constraint, no por SELECT

`WebhooksService.procesar()` inserta en `WebhookLog` y trata `P2002` como "ya procesado".
Un `SELECT` previo tendria una condicion de carrera entre el check y el insert; el
`@@unique([origen, externalId])` la elimina.

### Verificacion de sesion

El token de Pub/Sub se compara con `timingSafeEqual` (no `===`): una comparacion normal filtra
el prefijo correcto por diferencia de tiempo. `timingSafeEqual` exige igual longitud, por eso
se exige `a.length === b.length` antes.

---

## Fase 2 — Pedidos (#2.6)

### Socket.IO: `.to(a).to(b).emit()` es OBLIGATORIO, no dos `.emit()` seguidos

Un socket que esta en dos salas recibe **dos copias** si se hacen dos emisiones
separadas. Pasa en cuanto un usuario pertenece a dos salas a la vez:

- el cliente esta en `cliente:{clienteId}` **y** en `pedido:{pedidoId}`;
- un dueno con `accesoMultiSucursal` esta en la sala de su sucursal **y** en `negocio:{negocioId}:duenos`.

Encadenar las salas (`server.to(a).to(b).emit(...)`) las une y Socket.IO entrega
**una sola** copia por socket. Este bug estuvo en `/visitas` desde el Lote 4 y se
corrigio junto con `/pedidos`.

### Rate limiting: limites configurables por env

`POST /pedidos` limita a 10 por hora por IP y `GET /pedidos/publico/:linkToken` a
30 por minuto (anti fuerza bruta). Una suite e2e que cree 15 pedidos choca con su
propio limite y devuelve 429. Por eso los limites se leen de
`RATE_PEDIDOS_CREATE_LIMIT` / `RATE_PEDIDOS_CREATE_TTL_MS` y
`RATE_PEDIDOS_LINK_LIMIT` / `RATE_PEDIDOS_LINK_TTL_MS`, con esos defaults.
Nota: al ser un decorador, `process.env` se lee al DEFINIR la clase, asi que el
override tiene que venir como variable de entorno real del proceso, no del `.env`.

### El cliente puede cancelar desde PENDIENTE (no reusar la tabla del staff)

La tabla de transiciones es la del **staff** (`PENDIENTE -> CONFIRMADO | RECHAZADO`).
El CLIENTE si puede cancelar un pedido `PENDIENTE` o `CONFIRMADO`. Reusar
`transicionValidaParaTipo` en `cancelarPedido` devolvia 400 en un caso legitimo;
esa ruta valida los estados explicitamente.

### `menuActivo` es por NEGOCIO, no por sucursal

Vive solo en `ConfiguracionClub` y no esta en la lista de overrides de
`ConfiguracionSucursal`. Si en algun momento hace falta apagarlo por sucursal hay
que agregar la columna + migracion.

### Arrays vacios en `ConfiguracionSucursal` = heredar, no override

`tiposPedidoHabilitados` y `modosPagoHabilitados` son no-nulables sin default, asi
que un `[]` es un valor valido y NO significa "sin override". `configEfectiva()`
trata el array vacio como vacio (hereda del club); si se usara `??` directo, una
sucursal con `[]` quedaria con CERO tipos de pedido habilitados.

---

## Fase 2 — Modificadores + Upsell (#2.7)

### `updateMany` NO acepta operaciones de relacion

`disconnect` / `connect` / `set` solo existen en `update` / `create`. En el borrado
de un grupo con items asignados hay que hacer **un `update` por item** dentro de la
transaccion:

```
// MAL: TypeScript lo rechaza y Prisma no lo soporta
tx.itemCarta.updateMany({ where: {...}, data: { gruposModificadores: { disconnect: { id } } } })
// BIEN
for (const it of items) tx.itemCarta.update({ where: { id: it.id }, data: { gruposModificadores: { disconnect: { id } } } })
```

### `@IsUUID()` no sirve: los IDs son cuid

Los prompts piden `@IsUUID()` para los IDs, pero el schema usa `@default(cuid())`.
`@IsUUID()` rechazaria **todos** los IDs reales. Se usa `@IsString()`.

### Validar que un 400 venga del lugar que creemos

Un test que manda `nombre: 'X'` (1 char) recibe 400 del **DTO**, no de la validacion
de negocio que se quiere probar: el test pasa pero no prueba nada. Verificar el
**mensaje** del error, no solo el status.

### Cargar modificadores de un pedido sin N+1

`calcular-totales` trae en UNA query todos los items con `gruposModificadores` +
sus `opciones`, y valida en memoria. Un `findMany` por item (o por grupo) seria N+1.

### El precio base lleva el override de sucursal; los extras NO

`precioFinal = precioBase(ItemCartaSucursal de ESA sucursal) + suma(precioExtra)`.
Los grupos y opciones son del negocio: no existe override de modificadores por
sucursal en el schema.

---

## Fase 2 — Turnos + Asignacion (#2.8)

### CAMBIO DE CONTRATO DEL WEBSOCKET (afecta al #2.6)

| | #2.6 | #2.8 |
|---|---|---|
| Destino de `pedido:nuevo` | `sucursal:{id}:empleados` | `empleado:{id}` de **cada notificado** |
| Fallback | — | `sucursal:{id}:empleados` si la lista queda vacia |
| Duenos | `negocio:{id}:duenos` | igual (van en la MISMA cadena `.to()`) |

El test del #2.6 (que miraba la sala de la sucursal) sigue pasando: con un solo
empleado en turno, la notificacion individual y la de sucursal coinciden; y si no
hay nadie en turno, el fallback emite a la sala de la sucursal.

`empleado:{empleadoId}` ya existia en el gateway (lo usaba `enviarAEmpleado`); el
staff ahora **tambien se une a esa sala en el handshake** para poder recibirla.

### Los duenos siguen recibiendo los pedidos entrantes

Al pasar de la sala de sucursal a la individual es facil dejar afuera a
`negocio:{id}:duenos` y romper la PWA Admin sin que ningun test de staff lo note.
Va en la misma cadena `.to()` para no duplicar al dueno con `accesoMultiSucursal`,
que esta en las dos salas.

### `horaInicio` / `horaFin` son `String`, y el unique NO evita solapamientos

El schema los guarda como `String` (`"18:00"`), asi que:
- Hay que validar el formato: sin `^([01]\d|2[0-3]):[0-5]\d$`, `"8:00"` contra
  `"18:00"` rompe cualquier comparacion.
- `@@unique([negocioId, empleadoId, fecha, horaInicio])` **no impide solapar**:
  `18:00-23:00` y `20:00-22:00` tienen distinto `horaInicio` y pasarian. El
  solapamiento se valida en el servicio (`franjasSeSolapan`).

### Turnos que cruzan medianoche

Un turno `22:00-02:00` tiene `horaFin < horaInicio`. Comparar de forma lineal hace
que **nunca** matchee. Hay que:
- Para "esta en turno ahora": `ahora >= inicio || ahora <= fin`.
- Para solapamiento: expandir cada franja a intervalos, partir la que cruza en
  `[inicio,24:00]` + `[00:00,fin]` y comparar tambien las versiones `+24h`.
- Al buscar quien esta en turno, mirar **tambien los turnos de ayer**: a las 01:00
  el turno de las 22:00 de ayer sigue vigente.

### `updateMany` con el filtro en el WHERE = operacion atomica

Para "tomar un pedido" (modo BROADCAST) hay una carrera real entre dos meseros. Un
`findFirst` + `update` tiene una ventana entre el chequeo y la escritura. La forma
correcta:

```
const r = await prisma.pedido.updateMany({
  where: { id, negocioId, empleadoAsignadoId: null },  // el filtro VA ACA
  data: { empleadoAsignadoId: empleado.id },
});
if (r.count === 0) throw new ConflictException('Otro empleado ya tomo este pedido');
```

Probado con dos requests simultaneas: `[200, 409]`.

### No devolver datos internos desde un endpoint PUBLICO

`POST /pedidos` es publico (PWA Cliente + guests). Devolver `empleadoAsignadoId`,
`encargadoId` o la lista de notificados **filtra IDs de empleados a un anonimo**.
El detalle de la asignacion va a `EventoAuditoria` (`asignacionModo`,
`asignacionMotivo`, `notificadosIds`) y a los logs, no a la respuesta.

### Los crons deben ser disparadores finos

Poner la logica dentro del metodo `@Cron` la vuelve intesteable (no se puede
esperar a la medianoche). La logica vive en el servicio
(`transicionEncargado`, `duplicarSemanaAutomatica`, `cerrarHuerfanos`,
`recordarTurnosDelDia`) y el cron solo la invoca: asi se prueba invocando el
servicio con el reloj/fecha que se quiera.

### Un 400 puede venir del DTO y no de la validacion que queres probar

(Refuerzo de la leccion del #2.7.) Si mandas `nombre: "X"` (1 caracter) el 400 es
del `@MinLength`, no de la regla de negocio. Verificar SIEMPRE el **mensaje**.
Igual con el rate limit: `POST /pedidos` es 10/hora/IP por defecto, asi que un e2e
con mas de 10 pedidos empieza a recibir 429 y los fallos posteriores parecen bugs
del producto. Para tests: `RATE_PEDIDOS_CREATE_LIMIT` alto.

---

## Fase 2 — Gating por plan y limites (#2.9)

### `build: OK` mirando `error TS` NO alcanza: usar el exit code

`nest build` puede fallar y el error **no** aparecer como `error TS`: con un
`ReferenceError` de una constante borrada por error, tsc reporto `Found 3 error(s)`
y `pnpm` salio con codigo 1, pero un `grep "error TS"` no encontro nada y el chequeo
dio "OK". Peor: `lint` tampoco lo detecta (eslint no type-checkea), asi que la
unica senal confiable es el **exit code**. Chequear siempre `returncode == 0`.

### Unique compuesto con columna NULLABLE no deduplica

`UsoMensual` tiene `@@unique([negocioId, sucursalId, recurso, periodo])` con
`sucursalId` nullable. En Postgres los **NULL no colisionan entre si**, asi que ese
unique no impide dos filas con `sucursalId = null`; y Prisma no acepta `null` en el
`where` de un unique compuesto, asi que el `upsert` ni compila. Patron correcto:
`findFirst` + `create` con reintento ante `P2002`.

### Los query params llegan como STRING

`@IsInt()` sobre `@Query() dto.meses` rechaza `?meses=6` y devuelve 400.
`transform: true` en el `ValidationPipe` no convierte solo: hace falta
`@Type(() => Number)` de class-transformer.

### El filtro de excepciones se comia los campos propios

`HttpExceptionFilter` reconstruia la respuesta con solo `message` y `error`, asi que
un `throw new ForbiddenException({ message, recurso, estado, limiteBase, limiteGracia })`
llegaba al cliente sin `recurso/estado/limiteBase/limiteGracia` (la PWA no podia
mostrar el detalle). Ademas ponia `"error": "InternalServerError"` en un 403, porque
el nombre se tomaba del payload y solo habia fallback para las excepciones no-HTTP.
Ahora se preservan los campos extra y `error` sale del status real.

### `EventoAuditoria.negocioId` es obligatorio: no hay auditoria de plataforma

Un evento sin negocio (cambiar una PlanFeature desde el super-admin) no se puede
auditar: al pasar `negocioId: null`, `AuditoriaService` **se traga el error a
proposito** ("nunca lanza") y el evento desaparece sin aviso. Se deja el `Logger`
del server y se audita solo si hay negocio. Para el #9 hace falta una de dos:
`negocioId` nullable (migracion) o una tabla de auditoria de plataforma aparte.

### Cuidado: escribir PlanFeature por fuera del servicio deja el cache viejo

`PlanService` cachea `plan:features:{plan}` 10 min. Un `prisma.planFeature.update()`
crudo (o un UPDATE por SQL) **no invalida** el cache, asi que el gating sigue con el
valor viejo hasta 10 min. Siempre usar `PlanService.actualizarFeature()`.

### Nombres de campos que no siguen el patron del resto del schema

- `Sucursal.activa` (femenino) vs `Empleado.activo` / `Negocio.activo`.
- `CampanaMarketing.creadaEn` vs `Pedido.creadoEn` (el recurso cuenta campanas del
  periodo: usar `creadaEn`).
- `ItemCarta` **no tiene** soft delete: `carta.eliminar` pone `disponible = false` y
  **la fila sigue existiendo**. La reconciliacion cuenta todas las filas, asi que en
  ese endpoint NO se decrementa `ITEMS_CARTA` (si no, el cron del domingo revierte).

### La reconciliacion y el contador tienen que contar LO MISMO

`CAMPANAS_PUSH_MES` se reconciliaba contando filas de `CampanaMarketing` del periodo,
pero `push.enviarPromocion` no creaba esa fila: el contador subia por incremento y el
domingo se ponia en 0. Se crea la campana al enviar (es la fuente de verdad del
recurso, y ademas le da datos al reporte mensual).

### Gating condicional no puede ser decorador

`DELIVERY` depende del `tipo` del pedido: va como validacion en el servicio
(`exigirFeature`), no como `@RequiereFeature(...)`, que es estatico por handler.

### REGLA: los query params numericos necesitan `@Type(() => Number)`

`transform: true` en el `ValidationPipe` **no convierte tipos solo**: todo lo que
llega por `@Query()` es `string`. Un `@IsInt()` sobre `?meses=6` falla y devuelve 400.
Siempre:

```
import { Type } from 'class-transformer';
@IsOptional() @Type(() => Number) @IsInt() @Min(1) meses?: number;
```

### Auditoria de plataforma vs de negocio (dos tablas)

`EventoAuditoria.negocioId` es **obligatorio**; `EventoAuditoriaSuperAdmin` tiene
`negocioId` nullable y `superAdminId` obligatorio. Una accion que no pertenece a
ningun negocio (cambiar una PlanFeature) va a la segunda:

- `PlanService.actualizarFeature` y `setPayPerUse` aceptan
  `ctx.auditarComo: 'negocio' | 'super-admin'` (default `'negocio'`).
- Con `'super-admin'` se usa `AuditoriaService.registrarSuperAdmin()`, que exige
  `superAdminId`; si falta, **avisa por log y no registra** (no rompe).
- Siempre queda ademas el `Logger` del server, porque `AuditoriaService` se traga
  los errores a proposito y un evento perdido no deja rastro.

---

## Fase 2 — CRUD de Sucursales (#2.10)

### `resolver.invalidar()` era un NO-OP (cache de resolucion viejo 5 min)

```
const keys = [`sucursal:resolve:${negocioId}:*`];
for (const k of keys) { if (!k.includes('*')) await this.redis.del(k) }   // nunca borra
```

El unico key que armaba contenia `*`, asi que la condicion lo salteaba siempre: el
cache `sucursal:resolve:{negocioId}:{hash}` **nunca se invalidaba**. Renombrar una
sucursal, cambiar la principal o eliminarla dejaba al resolver devolviendo los datos
viejos hasta 5 minutos.

`RedisService` no exponia ninguna forma de borrar por patron (y `KEYS` esta
prohibido: bloquea el server y en Upstash puede no estar permitido). Se agrego
`RedisService.delByPattern()` con `scanStream`.

### Query params BOOLEANOS: `@Type(() => Boolean)` esta mal

Todo lo que llega por `@Query()` es `string`:

- `?force=true` con `@IsBoolean()` -> **400 "force must be a boolean value"**.
- `@Type(() => Boolean)` tampoco sirve: `Boolean("false") === true`, asi que
  `?activa=false` filtraria por `activa=true` (silenciosamente al reves).

Se usa el helper `QueryBool()` de `common/utils/query.util.ts`, que compara el texto
(`true/1/si` y `false/0/no`) y deja pasar el valor raro para que `@IsBoolean()` lo
rechace.

### `Sucursal` NO tiene soft delete con fecha: es `activa`

`Sucursal.activa` (femenino) — no existe `eliminadoEn` ni `activo`. Eliminar es
`activa: false`, y es **idempotente** (eliminar dos veces da 200 las dos veces).
Ademas `Pedido.sucursalId` es `onDelete: Restrict`: un DELETE real de la fila
fallaria si tiene pedidos, otra razon para el soft delete.

### Colchon de gracia: PROPORCIONAL con tope (no usos absolutos)

`limiteGracia = limiteBase + min(colchonGraciaDefault, ceil(limiteBase * 0.5))`

    0 -> 0 | 1 -> 2 | 100 -> 150 | 500 -> 550 | 5000 -> 5050 | 20 -> 30

Antes era en usos ABSOLUTOS (`limiteBase + 50`), y con limites chicos dejaba el
gating decorativo: **FREE `sucursales: 1` permitia crear 51** (1 + 50). Ahora la
gracia es 2 y al tercer intento bloquea. `colchonGraciaDefault` (ConfiguracionClub)
sigue siendo configurable por negocio: es el TOPE del colchon, no el colchon en si.

OJO con la formula: `max(ceil(base*0.5), min(50, base))` **NO** es lo mismo — con
base 500 da 750 y con 5000 da 7500. La correcta usa `min` para capar en 50.

`limiteBase = 0` (recurso no incluido en el plan) -> gracia 0: el primer uso excede.

La formula vive en `calcularLimiteGracia()` / `limiteGraciaDe()` de `plan.service.ts`
y la usan los 3 lugares que la necesitan (LimitesService, y las 2 de
UsoMensualService). No duplicarla.

---

## Fase 2 — Refactor multi-sucursal (#2.11)

### `@Global()` no alcanza para todo: el provider tiene que estar EXPORTADO

`SucursalResolverService` vive en `SucursalesModule` (@Global) y funciona en todos
lados sin importar nada. Pero `ConfiguracionService` (en `ConfiguracionModule`) solo
llega a quien **importe** ese modulo: por eso `NegociosModule` necesito
`imports: [ConfiguracionModule]`.

### Cuidado con los ciclos al inyectar servicios entre si

`ConfiguracionService` inyecta `SucursalResolverService` y al reves seria un ciclo de
providers que Nest no resuelve sin `forwardRef`. Por eso `resolverConfiguracionEfectiva`
**no** vive en el resolver: la config efectiva cacheada
(`configEfectivaCacheada`) esta en `ConfiguracionService`, que es quien tiene el merge.

### El override de una sucursal GANA sobre el club, siempre

Al invalidar el cache de config efectiva de un negocio esperaba ver el valor nuevo
del club, pero la sucursal tenia `premioTexto` propio: el valor efectivo sigue siendo
el de la sucursal. Es correcto: para probar que el cambio del club se propaga hay que
mirar un campo que la sucursal **no** overridee.

### El JWT del cliente solo lleva `sucursalId` con `modoClientes = POR_SUCURSAL`

Con `GLOBAL` el claim no se agrega: la sucursal se resuelve por request (query, header
o principal). Agregarlo siempre no rompe nada (el resolver lo ignora si el modo es
GLOBAL) pero contradice el contrato y ensucia el token.

### Los endpoints de un mismo recurso pueden no compartir verbo

`/sucursales/:id/configuracion` es **POST** (upsert), no PATCH. Un PATCH devuelve 405 y
el override nunca se guarda: si un test "falla" al verificar que el cambio se
propago, primero confirmar que el metodo HTTP es el correcto.

### Un server VIEJO escuchando en 3000 invalida TODOS los e2e

Si queda un `node dist/main.js` de una corrida anterior, el nuevo `spawn` no puede
tomar el puerto y **los requests van al proceso viejo**, con codigo viejo. Los tests
fallan de formas que no tienen nada que ver con el cambio que estas probando (en un
caso la respuesta tenia la forma ANTERIOR a la edicion, y el bug "desaparecia").

Antes de correr un e2e:

```bash
netstat -ano | grep ":3000.*LISTENING"        # ¿quien escucha?
taskkill /F /PID <pid>                        # OJO: en este bash es /F, no //F
```

`taskkill //F //IM node.exe` **falla** ("Argumento u opcion no valido - //F") y deja
el proceso vivo en silencio.

### `start:dev` no arrancaba: el mismo bug del `tsbuildinfo` que el build

`nest start --watch` reportaba "Found 0 errors" y despues moria con
`Cannot find module ...\dist\main`. Causa: `incremental: true` + un
`tsconfig.tsbuildinfo` al dia -> tsc cree que no hay nada que emitir y **no genera
`dist/main.js`**. `build` lo tenia resuelto con `prebuild: rimraf dist tsconfig.tsbuildinfo`,
pero `start`/`start:dev` no corrian ese limpio. Se agregaron `prestart` y
`prestart:dev` con el mismo `rimraf`.

### Los sellos GLOBAL vs POR_SUCURSAL estaban INVERTIDOS

`visitas.aprobar` hacia lo contrario de lo que pide el diseño:

- con `modoClientes = GLOBAL` actualizaba **solo** `Cliente.sellosActuales` (la
  `TarjetaClienteSucursal` quedaba en 0 para siempre);
- con `POR_SUCURSAL` actualizaba **tambien** `Cliente.sellosActuales` (no deberia:
  el saldo vive en la tarjeta de cada sucursal);
- y `premioDesbloqueado` se calculaba **siempre** con los sellos del cliente, nunca
  con la tarjeta de la sucursal.

Corregido: la tarjeta se actualiza **siempre**; `Cliente.sellosActuales` solo con
GLOBAL; y el premio se mide con la tarjeta cuando el modo es POR_SUCURSAL. Los
agregados globales (`totalVisitas`, `ultimaVisita`, `etiqueta`) siguen siendo globales
en los dos modos.

### Un checklist estatico en verde NO significa que este bien

`test:checklist` verifica estructura (resolver usado, filtro por sucursal, WS con
sala de sucursal, sin hardcodeos). Daba **16/16 OK** con el bug de sellos arriba
descrito, porque ese bug es de comportamiento y ningun chequeo estatico lo ve. El
script imprime su propio alcance para que nadie lo lea como una garantia.

### Los tests dejan DATOS sucios: revisar el seed despues de correr e2e

La prueba del `DELETE /sucursales/:id?force=true` **reasigna los empleados a la
sucursal principal**: dejo a Pedro Mesero en `centro` en vez de `norte`. Un e2e
posterior ("Pedro aprueba en norte") dio 403 y parecia un bug de permisos cuando el
dato ya no era el del seed. Despues de una tanda de e2e conviene verificar el estado
contra el seed (sucursales, empleados, contadores de `UsoMensual`).

## #3.0 — Soporte de backend para la PWA Cliente

### La cookie del cliente (A1): HttpOnly y no localStorage

Decision: el JWT del cliente viaja en una cookie **HttpOnly** (`cliente_token`) en
vez de quedar en `localStorage`, que es accesible desde JS y por lo tanto robable
con un XSS. `registrar` y `recuperar` la setean; `logout` la borra.

- En **produccion** (app y API en dominios distintos) hace falta
  `SameSite=None` **y** `Secure`: un navegador RECHAZA `SameSite=None` sin `Secure`.
- En **desarrollo** van `SameSite=Lax` y sin `Secure`, porque sobre
  `http://localhost` una cookie `Secure` no se guarda.
- Todo esto vive en `common/utils/cookie.util.ts` y se puede forzar con
  `COOKIE_SAMESITE` / `COOKIE_SECURE` / `COOKIE_DOMAIN`.
- El `accessToken` se sigue devolviendo en el body: el WebSocket no puede leer una
  cookie HttpOnly desde JS, asi que la PWA necesita el token para el handshake.

### El WebSocket NO ve `req.cookies`: hay que parsear el header a mano

En el handshake de un socket no existe `req.cookies` (no pasa por `cookie-parser`).
El gateway lee el header crudo:

```ts
leerCookie(socket.handshake.headers?.cookie, COOKIE_CLIENTE);
```

Y el servidor socket.io **tiene que** declarar `credentials: true` en el CORS, si
no el navegador directamente no manda la cookie en el handshake.

Orden de lectura del token en el gateway: `auth.token` -> `?token=` ->
`Authorization` -> cookie. Ojo: el gateway **no** lee `auth.Authorization` (el
`@repo/api-client` mandaba eso y no habria autenticado nunca).

### `@Public()` NO salva de un guard declarado a nivel de CLASE

`ModificadoresController` tiene `@UseGuards(StaffGuard, TenantGuard, RolesGuard,
PlanGuard)` en la clase: un metodo marcado `@Public()` adentro igual pasa por esos
guards. Para un endpoint publico hay que crear un **controller aparte**
(`ModificadoresPublicoController`) con solo `TenantGuard`.

**Victima real de esta trampa**: `GET /sucursales/publico` estaba declarado como
publico (con solo `@UseGuards(TenantGuard)` en el metodo) dentro de
`SucursalesController`, que tiene `@UseGuards(StaffGuard, TenantGuard, RolesGuard)`
en la CLASE. Respondia **401** y el comentario del codigo decia que era publico: el
selector de sucursal de la PWA Cliente no habria funcionado. Se movio a
`SucursalesPublicoController`. Regla: antes de dar por publico un endpoint, mirar
los guards de la CLASE, no solo los del metodo.

### `TenantGuard` deja pasar un tenant NULO

Si el host no tiene subdominio (por ejemplo `localhost`) y no hay header, el guard
setea `req.tenant = null` y **devuelve true** (falla abierto respecto del tenant,
no de la autenticacion). Un endpoint publico que haga `String(req.tenant)` termina
buscando el slug literal `"null"`. Hay que cortar explicitamente con 400, como hace
`GET /sucursales/publico`.

### La tabla no puede distinguir APROBADA de RECHAZADA

`TokenValidacion` solo tiene `usado`, asi que `aprobar` y `rechazar` dejan la fila
**identica**, y el evento de auditoria de `visita.rechazada` **no guarda el
tokenId**. `GET /visitas/estado/:token` no podria diferenciarlas.

Solucion sin migracion: al rechazar se escribe `visita:rechazada:{token}` en Redis
(TTL 30 min, seis veces la vida del token). Alcanza para el caso real, que es la PWA
consultando dentro de la ventana de 5 minutos del token. Si algun dia hace falta la
distincion historica, la alternativa limpia es `TokenValidacion.rechazadoEn
DateTime?` (requiere migracion).

### Los packages usan `exactOptionalPropertyTypes: true`

En `packages/*`, un `campo?: F` **no** acepta `undefined` asignado. Hay que declarar
la union explicita (`campo: F | undefined`) y, al armar opciones para una libreria,
usar spread condicional en vez de pasar `undefined`:

```ts
// MAL: { body: body ? JSON.stringify(body) : undefined }  -> TS2379
// BIEN:
const init: RequestInit = { method, headers, credentials: 'include' };
if (body !== undefined) init.body = JSON.stringify(body);

// MAL: { auth: config.token ? { token } : undefined }      -> TS2379
// BIEN: { ...(config.token ? { auth: { token } } : {}) }
```

### `node apps/backend/dist/main.js` desde la RAIZ falla con P1012

`ConfigModule.forRoot({ envFilePath: ['../../.env'] })` es **relativo al cwd**, y el
cwd esperado es `apps/backend`. Corriendo desde la raiz, `../../.env` cae fuera del
repo y Prisma muere con `P1012` (parece un error de schema y no lo es). Usar
`pnpm --filter backend start` o `cd apps/backend && node dist/main.js`.

## #3 — PWA Cliente: reglas de UI mobile

### Inputs de 56px (`h-14`) + `text-base` (16px), nunca menos

En iOS, un input con `font-size` menor a 16px provoca **zoom automatico** al
enfocarlo: la pagina se agranda, el layout se corre y el usuario queda
desorientado justo en el paso mas delicado (poner su WhatsApp). Por eso los
inputs del sistema usan `h-14` (56px) y `text-base`:

```tsx
// packages/ui/src/components/input.tsx
'flex h-14 w-full rounded-xl border border-input bg-background px-4 py-2 text-base'
```

Los botones van a 48px minimo (`h-12`), pero el input arranca en 56 porque es el
primer contacto del QR #2. Y siempre `type="button"` por defecto en el Button:
dentro de un `<form>`, un boton sin `type` hace submit y rompe el flujo.

### framer-motion: no se puede animar una propiedad por keyframes Y manejarla con un MotionValue

El backdrop del BottomSheet tenia que hacer dos cosas a la vez: fade in/out al
abrir y cerrar, y **seguir al dedo** durante el drag. Si se pone la MotionValue en
`style` y ademas `animate={{opacity}}` sobre la MISMA propiedad, framer ignora el
animate (la MotionValue manda) y el fade de entrada desaparece.

Solucion: **dos capas**, cada una duena de su propia animacion. La externa hace el
fade por keyframes; la interna usa la MotionValue del drag. El alfa visible es el
producto de las dos.

```tsx
<motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}>   // fade
  <motion.div style={{ opacity: opacidadBackdrop }} />                          // drag
</motion.div>
```

Y ojo: una MotionValue en `style` **solo funciona en componentes `motion.*`**. En
un `<div>` plano no compila (TS2322).

### Radix Dialog NO setea `aria-modal`

`@radix-ui/react-dialog` aporta `role="dialog"`, el focus trap, Escape y el
bloqueo de scroll, pero **no** agrega `aria-modal`. Hay que declararlo:

```tsx
<motion.div role="dialog" aria-modal={true} ...>
```

Evidencia de que el focus trap esta realmente enganchado: Radix agrega
`tabindex="-1"` al contenedor (es su FocusScope el que lo hace focusable por
programa), y con `asChild` esos props caen en TU elemento. Sin `tabindex="-1"` en
el HTML, el FocusScope no esta conectado.

### El BottomSheet no usa `Dialog.Portal`

El Portal de Radix necesita `document` (en SSR el contenedor es null y no
renderiza nada), asi que con Portal el sheet no existe en el HTML del servidor y
no se puede verificar con un render estatico. Como es un sheet fijo a pantalla
completa, no hay ganancia de apilado: se renderiza en el lugar.

### Escape y focus trap del BottomSheet: verificados a nivel de wiring, no en runtime

El BottomSheet delega la a11y en `@radix-ui/react-dialog` (modo modal: FocusScope
+ DismissableLayer), no en codigo propio. Se verifico que la maquinaria esta
**conectada** leyendo el HTML: el `tabindex="-1"` del contenedor lo agrega el
FocusScope (es lo que lo hace focusable por programa) y los handlers
`onPointerDownOutside`/`onInteractOutside` del DismissableLayer se aplican al
elemento.

**Verificacion runtime pendiente en Playwright (paso 8)**: disparar Escape y
comprobar `document.activeElement` dentro del sheet. Un render estatico no ejecuta
listeners, y `jsdom` daria cobertura falsa (no implementa focus real).

### El boton "Ver mas" de GoogleReviews necesita medicion, no solo CSS

`line-clamp-3` recorta el texto, pero saber si el boton "Ver mas" corresponde
exige comparar `scrollHeight` con `clientHeight` — y en el render de servidor no
hay DOM. Se resuelve con una estimacion por longitud (`>180` caracteres) y un
`ResizeObserver` que la corrige al hidratar. Sin la estimacion, el boton nunca
aparece en el primer render.

### Mediciones del DOM que afectan el render -> useLayoutEffect, no useEffect

Un `useEffect` corre DESPUES del paint: si de la medicion depende lo que se ve
(por ejemplo el boton "Ver mas" de GoogleReviews, que solo aparece si el texto
desborda), el usuario ve el salto — se renderiza sin el boton y aparece un frame
despues. `useLayoutEffect` corre antes del paint y el flicker desaparece.

**Pero** React avisa por consola si `useLayoutEffect` corre en el servidor (no hay
DOM). La solucion es el patron isomorfo, que mantiene el mismo orden de hooks:

```ts
const useLayoutEffectIsomorfo =
  typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect
```

Y el estado inicial arranca con una **estimacion** valida para SSR, que la medicion
real corrige antes del primer paint:

```ts
const [desborda, setDesborda] = React.useState(texto.length > 180)
```

Regla general: si una medicion del DOM cambia lo que se renderiza, va en
`useLayoutEffect` (isomorfo) y con un estado inicial estimable desde el servidor.

## #3 — TarjetaSellos (el componente estrella)

### El estado inicial de una animacion de ENTRADA no puede ser invisible

La entrada con `staggerChildren` arrancaba en `scale: 0, opacity: 0`. En un render
de servidor eso significa que el HTML sale con **los sellos invisibles** y la
tarjeta aparece recien cuando hidrata React: si el JS tarda o falla, la pantalla
mas importante del flujo queda en blanco.

Regla: una animacion de entrada arranca en un estado **ya visible** (`scale: 0.9`)
y solo hace el asentamiento. El `scale 0 -> 1` se reserva para el elemento NUEVO,
que siempre se agrega desde el cliente y por lo tanto no tiene problema de SSR.

### `exactOptionalPropertyTypes` tambien rompe las props de framer-motion

No es solo cosa de los DTOs del backend. En los packages:

```tsx
// MAL: style={cond ? { backgroundColor: c } : undefined}   -> TS2375
const estilo = cond ? { backgroundColor: c } : ({} as const)   // BIEN
<motion.span style={estilo} {...(cond ? { animate: {...} } : {})} />
```

Vale para `style`, `animate` y `transition`: la prop opcional no acepta
`undefined` explicito.

### El ultimo sello es SIEMPRE el premio (Gift), no solo cuando esta completo

Confusion facil: si el icono del premio se pone recien al completar, en una
tarjeta con 3 de 10 sellos el ultimo lugar se ve como un circulo vacio mas y el
usuario no entiende que ahi esta el regalo. Son dos cosas distintas:

- `lleno` (se pinto o no) -> Stamp cuando esta lleno, Circle cuando no.
- `esPremio` (es el ultimo lugar) -> Gift SIEMPRE.

Para 10 sellos con 3 llenos: 3 Stamp + 6 Circle + 1 Gift.

## #3 — Patron de accesibilidad: resumen arriba, detalle en el subarbol

En TarjetaSellos conviven dos cosas que a primera vista se contradicen: el
contenedor lleva `role="img"` con un `aria-label` descriptivo **y** cada sello
tiene su propio `aria-label` ("Visita 1 de 10, completada").

No se contradicen, es un patron deliberado:

- **`role="img"` en el contenedor** hace que el subarbol sea presentacional para
  el lector de pantalla: se anuncia UN resumen
  ("Tarjeta de Bar La Esquina: 3 de 10 visitas. Faltan 7 para Cafe gratis"), que
  es lo que el usuario necesita oir. Anunciar 10 sellos uno por uno es ruido.
- **El detalle queda en el DOM** (los 10 `aria-label`): no lo lee el lector de
  pantalla, pero es verificable en tests y sirve para debug.

Regla: cuando la informacion visual es densa y repetitiva, se resume en el
contenedor; el detalle se deja en el subarbol para tests, no para AT.

## #3 — Windows no puede con `output: 'standalone'` sin Modo Desarrollador

`next build` con `output: 'standalone'` copia `node_modules` a
`.next/standalone` usando **symlinks**, y en Windows eso falla con
`EPERM: operation not permitted, symlink` si no esta activado el Modo
Desarrollador. El error aparece al FINAL del build, despues de "Compiled
successfully": parece un fallo de compilacion y no lo es.

Solucion en `next.config.js`: standalone solo donde tiene sentido (Linux, que es
donde corre el Dockerfile), forzable con `NEXT_OUTPUT`:

```js
function salidaStandalone() {
  if (process.env.NEXT_OUTPUT === 'standalone') return 'standalone';
  if (process.env.NEXT_OUTPUT === 'default') return undefined;
  return process.platform === 'win32' ? undefined : 'standalone';
}
```

## #3 — Las props opcionales de los componentes de UI llevan `| undefined`

El monorepo usa `exactOptionalPropertyTypes`, y con eso una prop declarada
`estado?: EstadoTarjeta` **no acepta** que le pasen `undefined` explicito. El
caso normal en una app es justamente pasar una prop que puede ser undefined:

```tsx
// esto NO compilaba (TS2322 / TS2375)
<TarjetaSellos estado={estadoDerivado} />   // estadoDerivado: EstadoTarjeta | undefined
```

Por eso las props opcionales de `TarjetaSellosProps`, `BottomSheetProps` y
`GoogleReviewsProps` se declaran `prop?: T | undefined`. Es mas verboso, pero
evita que cada consumidor tenga que hacer spread condicional.

## #3 — `curl` (binario nativo) no entiende rutas MSYS `/tmp/...`

En este entorno bash es MSYS, pero `curl` es un ejecutable de Windows: con
`curl -o /tmp/x.html` escribe en OTRO lado (o falla) y despues el `grep` sobre
`/tmp/x.html` no encuentra nada. Para archivos que escribe un binario nativo hay
que usar una ruta nativa (`C:/Users/...`) o `$HOME`.

## `Decimal` de Prisma llega como STRING al JSON (y rompe las cuentas del front)

`GET /carta` devolvia `precio` como numero pero `precioBase` como **string**:

```json
{"nombre":"Coca-Cola 500ml","precio":3000,"precioBase":"1500","tieneOverride":true}
```

Motivo: el serializer hacia `Number(item.precio)` para `precio`, pero `precioBase`
salia del Decimal crudo, y Prisma serializa `Decimal` como string para no perder
precision. En la PWA eso explota en cuanto se hace `.toFixed()` o una comparacion
estricta sobre `precioBase`.

Regla: **cualquier campo `Decimal` que cruce la API se convierte con `Number()`
explicito**. Si alguna vez hace falta precision exacta de plata, se acuerda el
campo como string a proposito y se documenta — pero no puede quedar mezclado.

## En este entorno, `subprocess.run(shell=True)` desde Python usa cmd.exe, NO bash

Los comandos con sintaxis de bash fallan **en silencio**:

```python
# NO corre: `${PIPESTATUS[0]}` y `tail` son de bash; cmd.exe falla y no ejecuta nada
subprocess.run("pnpm --filter backend build 2>&1 | tail -12 ; echo EXIT=${PIPESTATUS[0]}", shell=True)
```

En un caso real esto hizo que el build NO se ejecutara, `dist/main.js` no existiera
y un e2e arrancara un server inexistente ("NO RESPONDE") pareciendo un problema de
la aplicacion. Para builds, tests y cualquier cosa con pipes: usar el terminal
(que si es bash), no `subprocess.run(..., shell=True)`.

### CONVENCION de @repo/ui: toda prop opcional declara `| undefined`

El monorepo usa `exactOptionalPropertyTypes`, y con eso `prop?: T` significa "puede
faltar, pero si esta tiene que ser T": pasarle `undefined` explicito es un error de
tipos. En React el caso normal es justamente pasar un valor que puede ser
undefined:

```tsx
const [estado, setEstado] = React.useState<EstadoTarjeta | undefined>('progreso')
<TarjetaSellos estado={estado} />   // sin `| undefined` en la prop: TS2322
```

Por eso, **en los componentes de `@repo/ui` las props opcionales se declaran
`prop?: T | undefined`**. Es mas verboso, pero evita que cada consumidor tenga que
hacer spread condicional (`{...(valor ? { prop: valor } : {})}`) en el call site.

Aplica a los datos (`estado`, `resenas`, `error`) y tambien a los callbacks y al
`className`. Al agregar un componente nuevo, seguir la misma convencion.

### `NODE_ENV=development` exportado rompe el build de Next (y parece un bug del codigo)

Si `NODE_ENV` queda exportado como `development` en la sesion del terminal,
`next build` compila contra el **React de desarrollo** y el prerender de TODAS las
rutas falla con errores que no tienen nada que ver entre si:

```
⚠ You are using a non-standard "NODE_ENV" value in your environment.
Error: <Html> should not be imported outside of pages/_document.
TypeError: Cannot read properties of null (reading 'useContext')
```

Pasan las dos cosas a la vez (`<Html>` y `useContext` sobre null) justamente porque
React corre en el modo equivocado. El stack apunta a
`react-dom-server.browser.development.js` durante un build de produccion: **esa es
la pista**.

De donde sale: `set -a; . ./.env; set +a` (comodo para exportar la config en un
e2e) exporta TODO el `.env` a la sesion, incluido `NODE_ENV=development`, y las
variables persisten entre llamadas del terminal.

Regla: despues de un `set -a; . ./.env`, hacer `unset NODE_ENV` (o no usar `set -a`
y exportar solo lo que hace falta). Antes de dar por roto un build de Next, chequear
`echo $NODE_ENV`.

### En la PWA, `declaration` va en false

El tsconfig compartido trae `declaration: true` (tiene sentido para un package que
se publica). En una app Next, con pnpm, eso hace que tsc tenga que **nombrar** el
tipo de retorno de funciones que devuelven tipos de librerias y falle con:

```
error TS2742: The inferred type of 'crearSocketVisitas' cannot be named without a
reference to '.pnpm/@socket.io+component-emitter@3.1.2/...'
```

La app no emite `.d.ts`, asi que va `declaration: false` (y `declarationMap:
false`). Ademas, conviene anotar el tipo de retorno explicito en los helpers que
devuelven tipos de librerias.

### La PWA Cliente NO puede tener un manifest dinamico (limitacion del browser)

El manifest se pide ANTES de que la app resuelva el tenant, y el browser no vuelve
a leerlo cuando cambia. Consecuencias, ya asumidas en el diseno:

- Icono y `name` son de Clubio (genericos), NO del negocio.
- `theme_color` del manifest tambien es generico. El color real del local se aplica
  por `<meta name="theme-color">` desde BrandingProvider (eso si es dinamico y es lo
  que pinta la barra del navegador en Android).
- `start_url` es `/` y el redirect al club lo hace la app: el inicio rehidrata el
  branding persistido y va a `/[tenant]/club`. Si no hay nada persistido, queda el
  mensaje de "escanea el QR".
- `display: standalone` significa que si un negocio queda inactivo, el icono viejo
  sigue en la pantalla de inicio del cliente: por eso el layout de `[tenant]`
  responde con "este enlace no es valido" en vez de un 404 pelado.

### Rutas sin tenant: el servidor no puede decidirlo solo

`/tarjeta`, `/historial` y `/seleccionar-sucursal` no tienen el slug en la URL. El
negocio sale de la sesion (cookie HttpOnly, el servidor no la puede leer) y del
branding persistido (localStorage, no existe en el servidor). Entonces:

1. SERVIDOR: se reenvia la cookie a `GET /api/auth/cliente/me`; si hay sesion, el
   negocio sale de ahi y el primer render ya trae los colores (sin flash).
2. CLIENTE (`GuardiaDeSesion`): si no hubo sesion, se rehidrata el branding
   persistido. Si tampoco hay, redirige a `/?motivo=sin-local`.

El paso 2 NO se puede mover al servidor. La prueba "con storage limpio /tarjeta
redirige a /" es un redirect del cliente: en el HTML del servidor se ve el skeleton,
no un 307. Se verifica en browser (Playwright, paso 8), no con curl.

El fetch del paso 1 va con `cache: 'no-store'` obligatorio: depende de una cookie y
cachearlo filtraria la sesion de un cliente a otro.

### La respuesta de registrar/recuperar cliente NO es el objeto del cliente

`POST /api/auth/cliente/registrar` devuelve un payload chico:

```
{ accessToken, expiresIn, negocio: { id, slug }, cliente: { id, nombre, telefono,
  sellosActuales, totalVisitas }, sucursal: { id, nombre, slug }, recienCreado }
```

`recuperar` devuelve lo mismo sin `sucursal` ni `recienCreado`. Es tentador tiparlo
como `ClienteMe & { accessToken }` (que es lo que uno espera por simetria con `/me`)
y compila, pero **el `negocio` de ahi solo tiene id y slug**: `respuesta.negocio.
colorPrimario` es `undefined` en runtime. Los datos del local salen de
`GET /negocios/publico/:slug` o de `GET /auth/cliente/me`.

Regla: los tipos de las respuestas se escriben mirando la respuesta REAL (o el
`return` del servicio), no por simetria con otro endpoint.

### `@repo/utils` y `@repo/validators` NO compilaban (nadie los importaba todavia)

Los dos packages tienen errores reales que no se veian porque hasta ahora ninguna app
los importaba (el `build` de turbo tampoco los miraba: se consumen por
`transpilePackages`, o sea por fuente).

En **packages/utils/src/index.ts**:

1. `determinarEtiquetaCliente` devolvia literales (`'VIP'`, `'NUEVO'`, ...) con tipo de
   retorno `EtiquetaCliente`. Un enum de strings NO acepta literales sueltos: son 4
   errores TS2322. Se devuelven los miembros `EtiquetaCliente.X`.
2. El mismo enum estaba `import type`, asi que no habia valor que devolver: pasa a
   import normal (y @repo/utils queda con dependencia de runtime de @repo/types, que
   funciona con transpilePackages).
3. `getSubdominio` declaraba `string | null` y devolvia `parts[0]`, que con
   `noUncheckedIndexedAccess` es `string | undefined` (TS2322).
4. `packages/utils` usaba `crypto.randomUUID()` (linea 102) sin libs: el tsc del
   package falla con TS2304. En las apps no se ve porque Next incluye la lib DOM.

**Y un desalineamiento de enums (falta decidir):**

- `schema.prisma` (fuente de verdad) y `@repo/types` dicen `REGULAR`.
- `packages/utils` devolvia `'RECURRENTE'` (ya corregido a `REGULAR`).
- `packages/validators/src/index.ts:104,142` usa `z.enum(['NUEVO','RECURRENTE','VIP',
  'INACTIVO'])`: en runtime **rechazaria el `REGULAR` que manda el backend**.

**Bug latente (sin tocar):** `determinarEtiquetaCliente(0)` sin `ultimaVisita` devuelve
`INACTIVO`, porque `diasSinVisita` queda en `Infinity` y la regla de >90 dias gana
sobre todo. Un cliente nuevo (sin visitas todavia) deberia ser `NUEVO`. Hoy no afecta
nada porque nadie llama a la funcion.

**El tsc de los packages tampoco corre**: `packages/utils` y `packages/validators`
tienen `rootDir: src` pero resuelven `@repo/types` por `paths` a su `src` -> TS6059.
Falta decidir si se consumen por `dist` (referencias de proyecto) o se saca `rootDir`.

### `set -a; . ./.env` contamina la sesion: usar dotenv-cli, con cuidado con CUAL dotenv

`set -a; . ./.env; set +a` exporta TODO el `.env` al shell y **afecta a todos los comandos
siguientes** de la sesion. `NODE_ENV=development` rompe el prerender de `next build`
(React de desarrollo en un build de produccion: `<Html>` y `useContext` de null, ver mas
arriba). Lo correcto es cargar el `.env` solo para ese comando. Pero ojo con CUAL `dotenv`
resuelve, porque hay DOS en esta maquina:

- El **local** (`dotenv-cli` del monorepo): acepta `-e, --env PATH` y `--`. Es el que
  sirve. Solo esta instalado en `apps/backend` (es el unico package que lo declara, para
  los scripts `db:*`).
- El **de PATH**: `C:\Users\<user>\AppData\Local\hermes\installs\...\venv\Scripts\dotenv`,
  que es el CLI **de Python** (python-dotenv, Click). Su `-e` es `--export BOOLEAN`, asi
  que `-e ./.env` falla con:
  `Error: Invalid value for '-e' / '--export': './.env' is not a valid boolean`.
  Sus subcomandos son `get/list/run/set/unset` (`dotenv -f .env run <cmd>`).

### La `-e` significa UNA COSA DISTINTA en cada `dotenv` (la trampa)

| | dotenv de **Node** (`apps/backend/node_modules/.bin/dotenv`, dotenv-cli 11) | dotenv de **Python** (el del PATH, venv de Hermes) |
|---|---|---|
| flag para el archivo | `-e <path>` **y** `--env-file <path>` | `-f/--file <path>`; `-e` es `--export` (BOOLEAN) |
| `-e ./.env` | carga el archivo | **falla**: `Invalid value for '-e' / '--export'` |
| como corre un comando | `dotenv -e .env -- <cmd>` | `dotenv -f .env run <cmd>` |

Verificado en esta maquina (el hijo ve `NODE_ENV=development` en los dos casos validos):

```bash
./apps/backend/node_modules/.bin/dotenv -e ./.env -- node -e "..."        # OK
./apps/backend/node_modules/.bin/dotenv --env-file ./.env -- node -e "..." # OK (no figura en --help, pero funciona)
pnpm dotenv -e ../../.env -- next build    # FALLA desde la raiz o apps/pwa-cliente
```

**Regla**: usar el bin local explicito desde la raiz, o instalar `dotenv-cli` en cada
package que lo necesite (hoy solo `apps/backend` lo declara, para los scripts `db:*`).

`node_modules/.bin/dotenv` NO existe en la raiz ni en `apps/pwa-cliente`, asi que ahi el
nombre suelto cae al de Python. Verificado:

```bash
# FUNCIONA desde apps/backend (tiene el dep)
pnpm dotenv -e ../../.env -- node -e "..."

# FUNCIONA desde la raiz (bin local explicito) y NO contamina el shell
./apps/backend/node_modules/.bin/dotenv -e ./.env -- pnpm --filter pwa-cliente build

# NO funciona desde la raiz ni desde apps/pwa-cliente (cae al dotenv de Python)
pnpm dotenv -e ../../.env -- next build
```

Si se quiere usar en la PWA, hay que agregar `dotenv-cli` a sus devDependencies o invocar
el binario por ruta. En los dos casos el proceso hijo ve `NODE_ENV=development` (lo toma
del `.env`) y el shell queda limpio.

### Node ejecuta TS directo, pero SOLO borra tipos: los parameter properties rompen

Node v22.6+ (y v26) corre `.ts` sin compilar, y en este proyecto eso alcanza para los
scripts de verificacion (una linea menos que mantener). Pero el modo por defecto es
**strip-only**: borra tipos y nada mas. NO transforma:

- **parameter properties**: `constructor(public status: number)` ->
  `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` (le pasa a `ApiError` de `@repo/api-client`).
- enums de TS y namespaces.

Por eso `scripts/check-flujo-ws.mts` arma el socket con `io` de socket.io-client en
lugar de importar `@repo/api-client` (que ademas traeria ese error desde el package).
Los archivos propios de la PWA si se pueden importar: no usan esas construcciones.
Si en algun momento hace falta consumir `@repo/api-client` desde node, alcanza con
escribir `ApiError` con campos explicitos en vez de parameter properties.

Para un script que ES module, el sufijo `.mts` evita el warning
`MODULE_TYPELESS_PACKAGE_JSON` sin tocar `"type"` del package (que si romperia los
configs CJS como postcss.config.js).

### El WS del cliente: `auth.token`, y en node hace falta `transports: ['websocket']`

El gateway lee `handshake.auth.token` (o la cookie HttpOnly). En un script de node no
hay cookies, asi que la identidad va en `auth: { token }` con `Authorization: Bearer`
para el HTTP. Ademas conviene `reconnection: false` en un harness para que el resultado
sea deterministico.

### Node strip-only: ni parameter properties ni decoradores

Node corre `.ts`/`.mts` borrando tipos, pero no los transforma. No soporta **parameter
properties** (`constructor(public status: number)`) ni **decoradores**, asi que un script
de node no puede importar packages que los usen (en este repo: `ApiError` de
`@repo/api-client` -> `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`).

Alternativas, en orden de conveniencia: usar `fetch`/`io` directos en el script (lo que
hace `scripts/check-flujo-ws.mts`), o compilar con `tsc` antes de correr.

No se cambia `ApiError` a campos explicitos: el costo de no poder importar el package
desde scripts es aceptable y la deuda no vale la pena.

### CORS: con credenciales el origen tiene que ser EXACTO (y el celular no es localhost)

La PWA Cliente usa `credentials: 'include'` (cookie HttpOnly), y eso cambia la regla de
CORS: el navegador exige que el origen de la pagina este **literalmente** en la lista, sin
comodines, y que la respuesta traiga `Access-Control-Allow-Credentials: true`.

Sintoma: la pantalla funciona (el SSR es del mismo origen, asi que no pasa por CORS) pero
al tocar un boton no pasa nada y en la consola del navegador aparece el bloqueo. Nada en el
servidor se ve mal: la request del navegador **nunca sale**.

Se cobra dos veces al probar desde el celular:

1. `CORS_ORIGINS` del `.env` tiene que incluir el origen **con la IP de la LAN**
   (`http://192.168.0.103:3001`), no solo `localhost:3001`.
2. Las llamadas del CLIENTE tienen que apuntar a la IP de la LAN, no a `localhost`:
   sin `NEXT_PUBLIC_API_URL=http://192.168.0.103:3000` en `apps/pwa-cliente/.env.local`,
   el telefono intenta pegarle a **si mismo** (`localhost` = el telefono) y falla.
   Ojo: `NEXT_PUBLIC_*` se inlinea en el bundle, asi que hay que reiniciar el server.

Verificacion (sin navegador, con la respuesta real):

```bash
curl -s -i -X OPTIONS http://localhost:3000/api/auth/cliente/registrar \
  -H "Origin: http://192.168.0.103:3001" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type" \
  | grep -iE "^HTTP|access-control-allow-(origin|credentials)"
```

Si `access-control-allow-origin` no es EXACTAMENTE el origen pedido, el flujo no va a
funcionar en el celular por mas que todo el resto este bien.

### En un monorepo, un package que nadie importa es codigo muerto

Tres packages de este repo nacieron rotos y **nadie lo noto**, cada uno por una razon
distinta:

| package | que tenia | como se manifesto |
|---|---|---|
| `@repo/api-client` | 14 backticks escapados `\`` + `auth.Authorization` en el socket | no compilaba (4 errores de sintaxis) y el WS nunca habria autenticado |
| `@repo/utils` | literales de string donde iba un enum (TS2322) + `getSubdominio` devolviendo `string \| undefined` | rompio el `tsc` del app en cuanto se importo |
| `@repo/validators` | bloque `export {}` duplicado (TS2323/TS2484) + 9 `.uuid()` sobre IDs cuid + 6 enums que no coincidian con el schema | `tsc` del package: 68 errores; ademas el schema nunca se validaba bien |

El `build` de turbo no los mira (se consumen por `transpilePackages`, o sea por fuente),
el lint tampoco y los tests no los tocan: **solo la integracion real los expone**. Y
"integrarlos" es un commit grande, donde el error se confunde con el trabajo nuevo.

**Regla: al crear un package nuevo, agregar un smoke test que lo importe y lo compile**,
aunque sea de una linea. Y cuando se toca un enum del schema, correr el check que lo
vigila (`check:validators`).

### Los IDs son cuid: la regex y como se verifica

Prisma genera los IDs con `@default(cuid())`: `'c'` + 24 caracteres `[a-z0-9]` = **25**.
En `@repo/validators` eso vive en `src/lib/cuid.ts`:

```ts
export const cuidSchema = z.string().regex(/^c[a-z0-9]{24}$/, 'ID inválido')
```

No usar `z.string().uuid()`: ningun endpoint de este proyecto acepta UUIDs, y el sintoma
es un "ID inválido" sobre un ID correcto (nueve schemas lo tenian).

Verificacion contra IDs reales (sirve cualquier ID que devuelva la API):

```bash
curl -s http://localhost:3000/api/negocios/publico/bar-la-esquina | grep -o '"id":"[^"]*"' | head -3
# cmuvjy46c001mbq7ja9r4edfd  -> 25 chars, matchea
```

Un UUID de ejemplo (`3f2504e0-4f89-11d3-9a0c-0305e82c3301`) NO matchea: por eso `.uuid()`
rechazaba IDs buenos. El `check:validators` prohibe `.uuid()` en el codigo del package.

### En Windows los scripts de pnpm corren con cmd.exe: comillas SIMPLES son literales

`pnpm -r --filter './packages/*' typecheck` responde `No projects matched the filters`
porque el filtro le llega al CLI **con las comillas pegadas**. Con comillas dobles
funciona igual en cmd.exe y en bash:

```json
"check:packages": "pnpm -r --filter \"./packages/*\" typecheck"
```

Regla: en los `scripts` de `package.json`, comillas dobles (el shell del sistema en Windows
no interpreta las simples).

### `check:packages`: el smoke test de los packages, en CI

`pnpm check:packages` = `tsc --noEmit` en cada package de `packages/*` (via el script
`typecheck` de cada uno). Existe porque un package que nadie importa no lo valida nadie y
tres de este repo nacieron rotos (ver mas arriba).

Detalles que importan:

- `@repo/config` queda afuera: es solo el tsconfig base, sin fuentes.
- `@repo/utils` usa `tsc --noEmit --rootDir ../..`: importa `@repo/types` como valor, y con
  su `rootDir: ./src` saltaban 4 TS6059. `--rootDir` es solo para el typecheck; el `build`
  sigue con su config (y sigue fallando por lo mismo: se cierra con Project References).
- `@repo/utils` necesito `@types/node` + `"types": ["node"]` para `crypto` y `atob`.
- El job `check-packages` de `.github/workflows/ci.yml` corre esto + `check:validators` +
  `check:maquina`, con Node 24 (los scripts `.mts` corren sin flag). Para que "si falla el
  PR no se mergea" hay que marcarlo como required en la proteccion de la rama.

### No correr `next build` con el `next dev` levantado en el mismo directorio

Comparten `.next`. El build reescribe el manifiesto y el dev server queda con las rutas
estaticas rotas, con un sintoma enganoso: unas responden 200 y otras 500
(visto: `/offline` -> 500 mientras `/bar-la-esquina/club` seguia 200).

Para el build de verificacion: **parar el dev server antes**, o aislar el `distDir`.
Si el dev server quedo raro, `rm -rf .next` y levantarlo de nuevo.

**Ojo con `NEXT_DIST_DIR`**: NO es una variable nativa de Next. En el codigo de Next solo
existe la interna `process.env.__NEXT_DIST_DIR` (doble guion bajo, la inyecta el build) y
`distDir` se lee del **config**, no del entorno. Escrito asi, `NEXT_DIST_DIR=.next-build
next build` no hace nada y pisa `.next` igual: falsa sensacion de seguridad.

Por eso el `next.config.js` de la PWA lo cablea a mano (mismo criterio que `NEXT_OUTPUT`):

```js
distDir: process.env.NEXT_DIST_DIR || '.next'
```

Con eso el aislamiento si funciona (verificado con el dev server vivo: el build escribe en
`.next-build` y las rutas del dev siguen respondiendo 200).

### Al verificar una clase de Tailwind, mirar el CSS SERVIDO (no el HTML)

1. **El HTML no prueba nada.** El nombre de la clase esta en el markup aunque Tailwind no
   haya emitido la regla, asi que un grep sobre el HTML da falso positivo (paso al
   verificar el fix del Tabs). El CSS sale de los `<link>` del HTML: grepear ahi.
2. **Las clases arbitrarias no siempre compilan, y fallan en silencio.**
   - Los espacios dentro de `calc()` van como `_` en la clase (`calc(100%_-_1rem)`):
     `calc(100%-1rem)` sin espacios es CSS invalido y Tailwind no lo emite.
   - Las mascaras complejas (`[mask-image:linear-gradient(...)]`) pueden no emitirse nunca,
     ni con los `_` correctos.
3. **Ante la duda: utilidad nativa o clase CSS real.**
   - `[scroll-snap-type:x_mandatory]` no se emitia -> `snap-x snap-mandatory`.
   - Los fades de borde -> clases `.tabs-fade-*` en el stylesheet.
   Ojo: el CSS del package (`packages/ui/src/styles/globals.css`) NO se importa desde la
   PWA (Next solo admite CSS global del arbol de la app): va la fuente en el package y una
   COPIA en `apps/pwa-cliente/app/globals.css`, como ya hacian los tokens.

### En una llamada de background, no encadenar nada antes del comando del servidor

```
terminal(background=true, command: "cd repo ; for pid in ...; do taskkill ...; done ; node dist/main.js")
-> termina al instante con "stdin is not a tty" y el servidor NUNCA arranca
```

Tambien pasa con `cd apps/backend && node dist/main.js` si antes hay un loop. Separar:
matar el puerto en una llamada (foreground) y arrancar el server en otra. Alternativa que
siempre funciona en foreground:

```bash
cd apps/backend ; (node dist/main.js > "$HOME/be.log" 2>&1 &) ; sleep 15 ; tail -20 "$HOME/be.log"
```

### Neon: si la base no responde, mirar el ROL antes que la red

Sintoma: `/api/health` con `db: down` y Prisma con `P1001 Can't reach database server
...:5432`, pero el TCP al host responde OK. En este proyecto la causa fue que **Neon tenia
otro rol** (`admin_role` en vez de `neondb_owner`): credenciales viejas en el `.env`. Se
arregla actualizando `DATABASE_URL` (host con `-pooler`) y `DIRECT_URL` (el mismo host sin
`-pooler`) y reiniciando el backend.

### Nunca usar el mismo campo como discriminante del evento y como payload

Cuando el evento lleva un valor que tambien sirve para identificarlo, renombrar el payload
(`nuevoTipo`, `nuevoEstado`, etc.). Si se repite el nombre, gana el payload y el
discriminante deja de matchear:

```ts
// MAL: `evento.tipo` pasa a valer 'DELIVERY', ningun case coincide y cae al default.
| { tipo: 'SET_TIPO'; tipo: TipoPedido }
// BIEN:
| { tipo: 'SET_TIPO'; nuevoTipo: TipoPedido }
```

Sintoma: la transicion "no hace nada", sin error de runtime y sin log. Lo cazo `check:carrito`
(el switch caia al `default`; el tipo quedaba en `null` y eso frenaba el envio del pedido).

### Los opcionales que reciben un valor posiblemente `undefined` lo declaran

El repo compila con `exactOptionalPropertyTypes`. Escribir `imagenUrl?: string` y asignarle
un `string | undefined` es error TS2375/TS2322. Va `imagenUrl?: string | undefined`
(es la convencion de `@repo/ui`; vale para todo el repo, no solo para las props de React).

### Al reusar un reducer con guarda de idempotencia, no fijes el valor nuevo antes de despachar

`rehidratar()` del carrito ponia la sucursal viva en el estado y RECIEN DESPUES despachaba
`CAMBIAR_SUCURSAL` con esa misma sucursal. El reducer compara contra la sucursal del estado y,
al ser iguales, su guarda de idempotencia lo tomaba como "misma sucursal": no vaciaba el
carrito ni ponia el aviso, en silencio.

Regla: el estado tiene que conservar el valor ANTERIOR cuando se despacha el evento, para que
la guarda pueda distinguir "cambiar" de "ya esta". El valor nuevo se escribe solo cuando el
evento no se hace cargo.

Sintoma: la pantalla queda igual y no hay error ni log. Lo cazo `check:carrito`.

### En un test que muta config, la captura va en el PRIMER punto posible

Regla: si el test guarda el valor original para restaurarlo, la lectura tiene que ocurrir ANTES
de cualquier mutacion. Si se hace despues, el "original" ya viene sucio y el teardown restaura
el valor equivocado: el test pasa y deja la config peor que antes.

Paso en `e2e_s3.cjs`: la captura estaba justo antes de la ultima mutacion, asi que
`permitirOverrideSucursal` se guardaba ya en `true` y el teardown lo reponia en `true`. Se
detecto porque la verificacion arranco el flag en `false`: si el valor de partida hubiera sido
el mismo que el hardcode, el test habria pasado sin probar nada. Corolario: **verificar con un
valor distinto del que el codigo hardcodea**, o la verificacion es vacua.

### Los e2e de sucursales: como se corren

`e2e_s3.cjs` / `e2e_s4.cjs` leen la base de `DATABASE_URL || DB_URL` (ojo: `DB_URL` solo NO
existe en el `.env`, ahi es `DATABASE_URL`). Se corren con:

```
pnpm --filter backend test:e2e:s3
pnpm --filter backend test:e2e:s4
```

que ya inyectan el `.env` con `dotenv -e ../../.env --`. Corridos pelados salen con exit 1 y
sin imprimir nada.

### Arrancar el backend desde un script: DETACHED_PROCESS

El terminal devolvia `stdin is not a tty` de forma intermitente cuando el comando encadenaba
un `taskkill`, y el servidor no arrancaba. Desde Python es determinista:

```python
subprocess.Popen(["node","dist/main.js"], cwd=apps_backend,
                 stdout=open(log,"w"), stderr=subprocess.STDOUT,
                 creationflags=0x00000008|0x00000200, close_fds=True)   # DETACHED|NEW_GROUP
```

### Regla general: verificar con un valor distinto del que el codigo hardcodea

Si lo que se prueba escribe un valor fijo (un `false` hardcodeado, un default, un id semilla),
la verificacion tiene que arrancar con OTRO valor. Si arranca con el mismo, el sistema queda
igual que estaba y el test pasa sin haber probado nada: es una verificacion vacua.

Vale para tests, para verificaciones manuales y para scripts de diagnostico. Dos corolarios:
- Al mutar algo para probar, leer y guardar el valor previo ANTES de tocarlo; si no, se
  restaura el valor equivocado.
- Si no se puede partir de otro valor (por ejemplo, un campo que no es editable por API),
  decirlo: la verificacion es mas debil de lo que parece.

### Cuando hay banderas/estados que deciden comportamiento, el orden de los chequeos importa

Un `if` mal ordenado puede hacer que un caso NUNCA se ejecute, y en silencio: el flujo
"funciona" y el caso que falta solo aparece en produccion o cuando alguien mira el resultado
con atencion.

Caso real (`planDeFetch`, cache de la carta): `refetchPendiente` se evaluaba ANTES que la
lectura, asi que el caso "sin cache" devolvia `background` en vez de `bloqueante`. Consecuencia
concreta: la pantalla se quedaba vacia y no se pedia nada. Ninguna asercion lo cubria hasta que
se escribio la del caso "sin cache".

Patron recomendado: la **POLITICA** vive en un solo lugar (el reducer o una funcion pura) y el
**PLAN** (que hacer) es una traduccion de esa politica. No mezclar. Si el plan vuelve a decidir
por su cuenta, se desincroniza con la politica y reaparece exactamente este bug.

Corolario: si dos banderas pueden ser verdaderas al mismo tiempo, escribir la asercion del caso
en el que AMBAS lo son. Es el que se olvida.

### Los Decimal de Prisma cruzan la API como STRING (no como numero)

Sintomas:
- Comparaciones que fallan en silencio: `precio > 1000` con `"1500"` -> false.
- Calculos que dan NaN: `"1500" * 2`.
- Aritmetica silenciosamente incorrecta (concatenacion en vez de suma).

**Fix: normalizar en el punto de entrada al frontend** (el hook o el cliente API), no en cada
consumidor. Si se normaliza en cada lugar donde se usa, tarde o temprano alguien se olvida y
vuelve el bug. En este repo: `useCarta` y `useModificadores` normalizan con `Number()` antes
de exponer el estado, asi el reducer y la UI nunca ven un string.

Estado verificado de cada endpoint (medido, no supuesto):

| Endpoint | Campo | Hoy llega como |
|---|---|---|
| `GET /carta?sucursalSlug=` | `precio`, `precioBase` | **number** (el service ya hace `Number()`) |
| `GET /modificadores/items/:id/grupos` | `precioExtra` | **string** (`"0"`) <-- el caso vivo |
| `POST /upsell/calcular` | `item.precio` | **number** |

O sea: la proteccion en el hook no es teorica, `precioExtra` es un string hoy y el modal de
modificadores calcula el precio en vivo con el, asi que sin normalizar el total sale mal.

### Mensajes de commit con comillas dobles: usar `git commit -F`

El shell parte el comando en la primera comilla doble del mensaje y `git` toma el resto como
pathspecs. Sintoma exacto: `error: pathspec 'X' did not match any file(s) known to git`, y el
commit NO se hace (queda todo staged).

Fix: escribir el mensaje a un archivo y commitear con `git commit -F mensaje.txt`. Aplica a
cualquier commit con comillas, backticks, `$` o parentesis.

### Nunca parchear por texto suelto una linea que se repite en varios `case`

Cuando una linea se repite en varios `case` de un reducer, **anclar en el label del caso**
(`case 'EXPIRAR':`). El replace por texto puede caer en otra ocurrencia y dejar el bug vivo
creyendo que esta arreglado.

Caso real: la anulacion de `mensajeWhatsApp`/`urlValidacion` en `EXPIRAR` se aplico con un
`str.replace(..., count=1)` sobre el `return` compartido por varios casos, y cayo en el primero
que matcheo. El `case 'EXPIRAR'` real siguio sin anular nada, asi que el mensaje y el link del
token vencido sobrevivian al vencimiento. Lo encontro la asercion del roundtrip
(`SOLICITADA` -> `EXPIRAR` -> null), no la lectura: el parche "parecia" aplicado.

Corolario: una asercion no sirve para confirmar que algo anda; sirve para descubrir que no anda.
Escribirla despues de "arreglar" es cuando mas vale.

### Las URLs que abre el cliente van con IP de LAN, nunca `localhost`

`STAFF_APP_URL` debe usar la IP de LAN (`http://192.168.0.103:3002`), no `localhost`. Desde el
celular, `localhost` es **el celular mismo**, no la PC: el link de validacion del QR #2 abria una
pantalla vacia sin ningun error. Regla general: **cualquier URL que el cliente abra debe usar la
IP de LAN.** Aplica a `STAFF_APP_URL`, `CORS_ORIGINS` y a los `NEXT_PUBLIC_*` de las PWAs. En
staging/produccion el equivalente es el dominio publico, que ya no tiene este problema.

Nota: la PWA Staff todavia no existe (llega con el Prompt #4), asi que ese puerto va a responder
recien ahi. Mientras tanto la aprobacion de visitas se hace por API para testing.

### Los endpoints publicos de la carta exigen el header `X-Tenant-Slug`

`GET /carta` (y los demas endpoints publicos del negocio) requieren el header **`X-Tenant-Slug`**.
Sin el, el backend responde:

```
404 {"message":"Falta el tenant (X-Tenant-Slug) para servir la carta"}
```

Desde la PWA no se nota nunca, porque el `ApiClient` lo agrega solo. Aparece recien cuando se
prueba con `curl`, y el 404 hace pensar que la ruta esta mal (no lo esta). Forma correcta:

```
curl -H "X-Tenant-Slug: bar-la-esquina" "http://localhost:3000/api/carta?sucursalSlug=centro"
```

Detalle util: `check-carta.mts` **no toca el backend** (es el check del cache, "refinamiento 4").
Si hace falta la URL real de la carta, esta en `lib/carta-cache.ts` y en `types/api.ts`, no en el
check.

### REGLA: los tipos defensivos del backend se normalizan en UN solo lugar

Patron general (vale mas que cualquiera de los casos sueltos): **los tipos defensivos del backend**
(campos opcionales que "siempre vienen", `Decimal` serializado como string) **chocan con los tipos
estrictos de los consumidores**. El lugar para resolverlo es **UNO: la frontera** (el hook, el
cache, o un tipo permisivo como `GrupoValidable`). Nunca en cada consumidor: se olvida uno y el bug
vuelve, o peor, el typecheck lo caza recien cuando ya esta escrito en tres lugares.

Cuando aparece un tipo defensivo nuevo del backend, la pregunta es siempre la misma:

> "Cual es el punto unico donde normalizo esto?"

Casos ya resueltos con este criterio:

- **`precioExtra` (Decimal -> string)**: se normaliza con `Number()` al entrar al cache
  (`modificadores-cache.ts`). Si se normalizara en el modal o en el carrito, quedarian dos copias
  de la verdad y una se olvidaria.
- **`maxSelecciones`/`minSelecciones` opcionales**: el backend los declara opcionales aunque los
  manda siempre. Se resuelve con el tipo `GrupoValidable` y los defaults en el validador
  (`min = minSelecciones ?? (obligatorio ? 1 : 0)`, `max = maxSelecciones ?? Infinity`). Aflojar el
  parametro sirvio ademas para que `GrupoModificador` (el estricto del carrito) siga siendo
  asignable: nadie tuvo que cambiar una linea.
- **`mensajeWhatsApp`/`urlValidacion`**: viajan dentro del evento `SOLICITADA` del reducer, no como
  estado suelto del store. Asi el reset (EXPIRAR/RESET) sale gratis y no hay que acordarse de
  limpiarlos en cada camino.

Contraejemplo (lo que NO se hace): normalizar el `precioExtra` dentro del modal "porque ahi se
usa", o rellenar los min/max al entrar a cada consumidor. Duplica el criterio y garantiza que la
proxima ruta lo olvide.

### REGLA: los literales que vienen de un mensaje se verifican en el codigo, no se pegan directo

Cuando se copia un literal (un string de union, un slug, la key de un enum, un nombre de campo)
desde un mensaje, un ticket o una captura, **NO pegarlo directo: verificar el valor real en el
codigo primero**. El que escribe el pedido esta recordando de memoria.

Lo peligroso es la asimetria de la red de seguridad:

- Si el literal es un **miembro de un union** (o un enum con tipo), el typecheck lo caza: da
  "no hay solapamiento entre los tipos" y no llega a produccion.
- Si el literal es una **key de un objeto**, un **string suelto** o el **valor de comparacion**
  de un dato que viene de la API, el typecheck **no dice nada**: compila, y el bug es silencioso
  (la condicion nunca es verdadera, el mapa nunca encuentra la clave).

Casos reales de este proyecto:

- `'esperarHoras'` (como venia en el pedido) vs **`'esperaHoras'`** (el valor real del union
  `MotivoNoSumada`). Lo cazo el typecheck, por ser union.
- `'Recurrente'` (como venia en el pedido) vs **`'REGULAR'`** (el valor real del enum en
  `@repo/validators`), en el fix de validadores. Este caso NO tenia red: se habria compilado igual.

Regla practica: antes de escribir un literal, hacer un `grep` del valor aproximado y copiar el
string **desde el codigo**, no desde el mensaje. Si hay que elegir entre "lo que dice el pedido" y
"lo que dice el codigo", gana el codigo, y se avisa que el pedido decia otra cosa.

### REGLA: toda ruta HTTP sale de `endpoints.X`; nunca se escribe a mano

La ruta de una llamada al cliente **sale de `endpoints`** (que ya incluye el prefijo `/api`), nunca
se escribe como literal. Aplica a las **tres** formas de string:

```ts
api.get('/carta')                    // MAL (comillas simples)
api.get("/carta")                    // MAL (comillas dobles)
api.get(`/modificadores/${id}`)      // MAL (backtick) <- el que se escapa en los barridos
api.get(endpoints.carta.list)        // BIEN
api.get(endpoints.modificadores.gruposDeItem(id))  // BIEN
```

**Corolario para barridos:** al buscar hardcodeos hay que cubrir las TRES formas de string literal.
Un grep de `'/` y `"/` sin backticks deja pasar los template literals, que son justo los mas
comunes en los paths con parametros. (Pasó de verdad: un barrido que solo miraba comillas reporto
"no hay mas" y quedaba uno con backtick.)

### Leccion: la misma clase de bug costo dos rondas

Dos bugs distintos, una sola causa: una ruta escrita a mano sin el prefijo `/api`.

- **upsell**: `POST /upsell/calcular` (sin `/api`) -> 404 -> el estado del upsell quedaba en error
  -> el efecto reintentaba en cada render -> **event loop del navegador saturado** -> los handlers
  de click no llegaban a correr. Se veia como "el modal no abre" y "el badge no responde", que eran
  consecuencia, no causa.
- **modificadores**: `GET /modificadores/items/:id/grupos` (sin `/api`) -> 404 -> `CartaDigital`
  caia por el camino de "sin grupos" -> agregaba directo y **el modal no abria**.

Moraleja practica: un 404 en el cliente no siempre se ve como un error; puede disfrazarse de una
funcionalidad que "no anda" o de una pantalla que no responde. Antes de buscar el bug en la UI,
mirar la consola y el Network.

TODO de deuda tecnica (ver `BACKEND_PLAN.md`): que `ApiClient.request()` **tire error en
development** si el path no empieza con `/api/`. Asi esta clase se caza en la primera llamada y no
en el celular.

#### Integracion con el backend: el DTO y el response se leen del codigo, no se recuerdan

Cuando se integra con un endpoint nuevo, **los nombres de los campos del body y del response se
leen del codigo** (el DTO del backend y el `return` del service), nunca se escriben de memoria. Es
el mismo problema que copiar literales de un mensaje, pero con mas superficie: el typecheck no
puede ayudar porque el cliente arma un objeto suelto.

Casos reales de este proyecto (lo que se recordaba -> lo que dice el backend):

- `nombre` -> **`nombreCliente`**
- `numeroMesa` -> **`mesa`**
- `linkWhatsApp` -> **`urlCorta`** (el `mensajeWhatsApp` lo arma el backend; el cliente solo lo
  muestra, no lo construye)
- `pedido:actualizado` -> **`pedido:estado-actualizado`**

Ademas, el body del pedido usa `modificadores: [{ grupoId, opcionIds }]`, que es exactamente lo que
produce `modificadoresParaApi`: conviene mirar si el helper que ya existe arma la forma que el DTO
espera antes de escribir una conversion nueva.

### REGLA: los tests tambien asumen (revisar las guardas antes de culpar al codigo)

Cuando una asercion de roundtrip falla, **antes de tocar el codigo hay que verificar si la funcion
bajo test tiene guardas que cambian el comportamiento para el caso base**. Un test armado sobre el
estado inicial puede estar probando algo que, por diseno, nunca se persiste.

Caso real (notas del pedido): la asercion

```
FALLA  y sobreviven el roundtrip de localStorage  -> real=undefined  esperado="sin sal"
```

apuntaba a `deserializarCarrito`, que **devuelve `null` cuando el carrito no tiene items** (a
proposito: un carrito vacio no se rehidrata). El test habia armado el roundtrip sobre
`estadoInicial`, sin items, asi que la funcion devolvia `null` antes de llegar a mirar las notas. El
codigo estaba bien; el test estaba probando un camino que no existe.

Como se detecta rapido: leer la funcion bajo test y buscar salidas tempranas (`if (...) return null`,
`return estado`, cortes por caso vacio, banderas de "sin cambios"). Si el fixture cae en una de esas
guardas, el test no esta midiendo lo que cree.

Regla practica: un fixture tiene que llegar hasta el camino que se quiere probar, no quedarse en el
caso base. Y cuando el fixture se corrige, vale agregar la asercion que confirma que ese camino se
recorrio (en el caso real: que los items sobrevivan junto con las notas).

### REGLA: antes de despachar eventos en secuencia, verificar si el primero ya hizo el trabajo del segundo

El reducer puede tener casos que **absorben el estado completo**: en vez de tocar un campo, arman un
estado nuevo desde cero (`estadoInicial(...)`) y despues vuelven a poner lo que hay que conservar. Si
se despacha un segundo evento "por las dudas" (por ejemplo un `LIMPIAR` despues de un `PEDIDO_OK`),
ese segundo evento **pisa lo conservado** y rompe justo lo que se queria guardar.

Caso real (`PEDIDO_OK` + `LIMPIAR`):

```ts
case 'PEDIDO_OK':
  return { ...estadoInicial(...), fase: 'enviado', cliente: estado.cliente,
           tipo: estado.tipo, modoPago: estado.modoPago,
           pedido: { linkToken: evento.linkToken, numero: evento.numero } }

case 'LIMPIAR':
  return { ...estadoInicial(...), cliente: estado.cliente }   // <- pedido queda en null
```

`PEDIDO_OK` ya vacia el carrito y conserva a proposito `cliente`, `tipo`, `modoPago` y `pedido`
(este ultimo es el que permite volver al seguimiento despues de reabrir la app). Un `LIMPIAR`
adicional borra `pedido.linkToken` y se pierde el rastro del pedido: el bug aparece recien al
recargar, no en la pantalla que acabamos de ver.

Como detectarlo: leer el `case` del primero y fijarse si devuelve `estadoInicial(...)` o un objeto
armado desde cero. Si es asi, la lista de campos que conserva **es la lista de lo que no hay que
tocar despues**. La secuencia correcta, en general, es despachar **un solo evento** y que el reducer
decida que conservar.

Corolario: los comentarios del reducer que dicen "guarda dura" o "no se envia dos veces" suelen
indicar que el estado ya esta protegido; antes de agregar una guarda o un evento extra en el
llamador, conviene verificar que no este ya resuelto adentro.

### REGLA: si dependes de un valor del cliente HTTP, verifica que el cliente lo produzca

Cuando la logica se apoya en un valor especifico que deberia venir del cliente HTTP (por ejemplo
`status 0` para "error de red"), **hay que verificar que el cliente realmente lo produzca** antes de
escribir la condicion.

Caso real (reintento del checkout): el plan decia "si el error es de red (status 0), reintentar una
vez". Pero el `ApiClient` solo lanza `ApiError` cuando hay un `response.status` real:

```ts
throw new ApiError(response.status, data, data?.message || 'Error en la solicitud')
```

Si la request **ni sale** (sin red, DNS, servidor caido), `fetch` rechaza con un `TypeError` crudo:
no hay `ApiError`, no hay `status`, y la condicion `status === 0` **nunca se cumple**. El reintento
por red estaba muerto y no se notaba, porque el camino sin red es el que menos se prueba.

Fix: normalizar en un solo lugar antes de clasificar (`normalizarError`): si lo lanzado no tiene
`status`, es `0`.

Regla practica: cuando una condicion depende de un valor "del sistema" (status, codigo, bandera),
verificar quien lo produce y con que forma llega. Si nadie lo produce, la condicion es decorativa.

### REGLA: el `message` de class-validator puede ser un array

Nest con class-validator devuelve los errores de validacion como **array** cuando hay mas de uno:

```json
{"statusCode": 400, "message": ["property negocioSlug should not exist"], "error": "Bad Request"}
```

Mostrar eso crudo da `[object Object]` (o una lista rara) en la pantalla. Se normaliza a string
(hay que unir con espacios) **en un solo lugar**, no en cada consumidor: si se hace en la UI, la
proxima pantalla se olvida.

En este proyecto lo hace `normalizarError` (`lib/checkout-maquina.ts`), junto con el status 0:

```ts
if (Array.isArray(m)) mensaje = m.filter((x): x is string => typeof x === 'string').join(' ')
else if (typeof m === 'string') mensaje = m
```

Es el mismo criterio que la regla del punto unico de normalizacion: la frontera normaliza, los
consumidores consumen.

