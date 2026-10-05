# Troubleshooting

Errores conocidos del monorepo y sus soluciones.

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

