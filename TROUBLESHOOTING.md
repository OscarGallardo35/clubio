# Troubleshooting

Errores conocidos del monorepo y sus soluciones.

---

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

