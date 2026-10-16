# Plan: mover el backend a la region de Neon (o Neon a la de Railway)

> **Documento de DECISION. No se ejecuto nada de esto.** Es el paso a paso, con los riesgos y el
> rollback, para que lo decida el dueno del producto. Lo que SI se hizo (y esta deployado) es bajar
> los viajes secuenciales y sacar el trabajo externo de las transacciones: eso ya recortó la mitad
> del reloj de cada endpoint, pero **no elimina el piso** que impone la distancia entre regiones.

## 1. El problema, medido

El backend corre en Railway **`sfo` (San Francisco)** y la base (Neon) esta en **`sa-east-1` (Sao
Paulo)**. **Cada round-trip a la base cruza el continente: 200-450 ms medidos en prod, contra ~60 ms
desde Argentina.** Los endpoints no hacen un viaje, hacen muchos en serie: el reloj de cada request
es (cantidad de viajes secuenciales) x (latencia de un viaje).

Antes / despues de la optimizacion de viajes (mismo tenant `que-lomitos`, mismo harness
`test:latencia`, contra `api.clubio.lat`; el **minimo** es la mejor estimacion porque el ruido de la
red solo suma):

| Endpoint | viajes en serie | antes (min) | despues (min) | mejora | antes (mediana) | despues (mediana) |
|---|---|---|---|---|---|---|
| `GET /api/health` | 1 | 460 ms | 456 ms | 0% | 635 ms | 460 ms |
| `GET /api/negocios/publico/nonona-lomos` (control, sin tocar) | 1 | 1050 ms | 1048 ms | 0% | 1060 ms | 1436 ms (+35%) |
| `POST /visitas/solicitar` | 7 -> 3 | 2024 ms | **1244 ms** | **-39%** | 3754 ms | 2020 ms (-46%) |
| `POST /visitas/aprobar/:token` | 17 -> 9 | 3968 ms | **2443 ms** | **-38%** | 4168 ms | 3787 ms (-9%) |
| `GET /visitas/estado/:token` | 3 -> 2 | 1241 ms | **862 ms** | **-31%** | 1418 ms | 1035 ms (-27%) |
| `GET /visitas/mi-tarjeta` | 12 -> 5 | 2243 ms | **1444 ms** | **-36%** | 3025 ms | 1642 ms (-46%) |

El endpoint **control** (`nonona-lomos`, que no se toco) marca el piso de ruido de este camino:
**±35% en la mediana y 0% en el minimo**. De ahi que la tabla se lea por minimo.

Lo que queda **NO se arregla con mas codigo**: `aprobar` son ~9 viajes y de esos **6 son la
transaccion misma** (BEGIN + 4 statements + COMMIT). Para bajar de ahi hay que acercar las dos
puntas. Con el backend y la base en la misma region, cada viaje pasa de ~250-450 ms a ~1-5 ms.

## 2. Que hay que mover

Servicios del proyecto `79d3d325-0dfe-4bfc-8bac-389bd32be40d`, environment `production`
(`58673784-4fae-4f08-9f04-f429935b114c`):

| Servicio | id | Pega a Neon? | Hay que moverlo? |
|---|---|---|---|
| `backend` (NestJS + Prisma) | `bd9cee89-8190-4758-83c7-03ef512c1d66` | **SI, es el unico** | **SI** (es el objetivo) |
| `redis` (propio, BullMQ + cache) | `d1ad58e5-3fdc-45bb-b5a4-cd1240aac307` | no | **SI, junto con el backend** (ver riesgo 1) |
| `clubio-cliente` (PWA) | `09bb0cfb-0028-4129-831f-e92951026ec4` | no | Opcional. No pega a Neon, pero su SSR si hace fetch a `api.clubio.lat`: si el backend se va a SP y la PWA queda en sfo, ese hop (`revalidate: 30`) se vuelve intercontinental. Moverlas si se quiere el conjunto coherente. |
| `clubio-staff` (PWA) | `f9561c43-13bf-46c4-82d2-e5408c80e788` | no | idem |
| `clubio-admin` (PWA) | `40b5d201-779d-4db6-ae92-f01522382179` | no | idem |
| `clubio-superadmin` (panel operador) | `b02cf43b-b367-4118-8502-b09d092ccbe9` | no | idem (es la cuarta app, comparte el mismo criterio) |

> El `region` de cada `serviceInstance` viene **`null`** en esta version del GraphQL de Railway: la
> region es la del default del proyecto/entorno. **Confirmala en el dashboard** (servicio →
> Settings → Region) antes de tocar nada, y averigua ahi mismo el identificador exacto de la region
> de San Pablo (en Railway se llama `southamerica-east1`; el slug se verifica en el selector de
> region, no se adivina).

## 3. Las dos variantes

### Variante A (recomendada para el usuario final): mover RAILWAY a `southamerica-east1`

Gana tambien el tramo del navegador: **Argentina → Sao Paulo ~60 ms** contra **Argentina → San
Francisco ~180 ms**. Es el cambio que el cliente del local *siente* (la PWA es lo que se usa en el
mostrador).

Costo: hay que mover el Redis propio (volumen nuevo, ver riesgo 1) y la ventana de corte.

### Variante B (la de menor riesgo tecnico): mover NEON a la region de Railway (US)

El backend no se toca: **solo cambian `DATABASE_URL` y `DIRECT_URL`** (son TCP publico con TLS, sin
acoplamiento de red privada entre servicios). Cero cambios en Railway.

Costo: 1) hay que **migrar los datos** a un proyecto Neon en la region destino (Neon **no** permite
cambiar la region de un proyecto existente: se crea uno nuevo y se migra), y 2) el tramo
navegador→API sigue siendo intercontinental (~180 ms), o sea **no mejora la latencia que ve el
cliente**, solo la del backend contra la base.

**Decision sugerida:** A si el objetivo es la velocidad que ve el usuario (y se acepta una ventana
de corte de infraestructura); B si el objetivo es bajar el reloj del backend sin tocar los datos de
produccion mas que una migracion planificada.

## 4. Orden de ejecucion — Variante A

Se hace **fuera del horario de atencion** (03:00 ART) y con el dueno avisado: hay un tramo en el que
la red privada no puede cruzar de una region a la otra (riesgo 1), asi que **no existe una secuencia
de cero downtime por API**; lo que si existe es una secuencia corta y con rollback.

1. **Preparar (sin cortar nada, dias antes)**
   - Anotar el estado actual: `meta.commitHash` de cada servicio, `REDIS_URL`, `DATABASE_URL`,
     `DIRECT_URL`, `PUBLIC_APP_URL`, `STAFF_APP_URL`, `CORS_ORIGINS` (leer, no imprimir valores de
     secretos: comparar por huella).
   - Medir el **antes**: `OUT=latencia-antes-region.json pnpm --filter @mi-saas/backend test:latencia`.
   - Confirmar la region destino en el dashboard y que el plan permita crear el volumen ahi.
2. **Redis nuevo en la region destino** (sin tocar el viejo):
   `serviceCreate({ name: "redis-sp", source: { image: "redis:7-alpine" } })` +
   `volumeCreate({ mountPath: "/data" })` +
   `serviceInstanceUpdate({ startCommand: "redis-server --appendonly yes --maxmemory-policy volatile-lru" })` +
   `serviceInstanceDeployV2`. **La region se elige al crear el servicio/volumen** (el volumen es
   region-bound: no se puede mover, se crea uno nuevo).
   Verificar que arranca (`deployments(first: 1)` en `SUCCESS`).
3. **Drenar las colas** del Redis viejo: esperar a que la cola de push quede vacia (pico de
   inactividad). Lo que quede encolado se pierde si no se drena (son notificaciones, no plata).
4. **Ventana de corte (una sola pasada, ~5-10 min)**
   - `variableUpsert` del `REDIS_URL` del backend apuntando al **DNS privado del Redis nuevo**
     (leerlo de las variables del servicio nuevo; el valor va **explicito**, no como
     `${{servicio.VAR}}` interpolado dentro de la URL: eso no interpola y termina en `WRONGPASS`).
   - `serviceInstanceUpdate` del backend con la **region nueva** + `serviceInstanceRedeploy`.
   - Opcional en la misma ventana: cambiar la region de las 4 apps (otra pasada de deploy por app).
5. **Verificar** (seccion 5).
6. **Decomisionar despues, no en caliente**: el Redis viejo y su volumen se dejan vivos **una
   semana** (es el rollback). Recien entonces se borran.

## 4-bis. Orden de ejecucion — Variante B (mover Neon)

1. Crear el proyecto Neon en la region de Railway (mismo branch/DB) y anotar sus dos cadenas
   (pooled = `DATABASE_URL`, directa = `DIRECT_URL`).
2. Migrar los datos **con la app en modo solo-lectura o en ventana**: `pg_dump --format=custom` del
   origen + `pg_restore` en el destino (incluye la tabla `_prisma_migrations`: sin ella Prisma no
   sabe que migraciones ya corrieron). Alternativa sin ventana larga: replicacion logica de las
   tablas (mas trabajo de verificacion).
3. Verificar en el destino: counts por tabla de las criticas (`Cliente`, `Visita`, `Pedido`,
   `PremioOtorgado`, `TokenValidacion`, `EventoAuditoria`), la ultima fila por `creadoEn`, y que los
   ids/seguencias sigan avanzando (un `create` de prueba en una transaccion que se revierte).
4. `variableUpsert` de `DATABASE_URL` y `DIRECT_URL` en el backend + `serviceInstanceRedeploy`.
5. Verificar (seccion 5) y dejar el proyecto Neon viejo vivo una semana.

## 5. Como verificar despues

1. **Deploy sano y en el commit correcto**: por cada servicio, `deployments(first: 1)` en `SUCCESS` y
   su `meta.commitHash` igual al HEAD. Un `FAILED` **no tumba** el servicio: sigue sirviendo el
   ultimo `SUCCESS`, asi que "no paso nada" tambien hay que verificarlo, no asumirlo.
2. **Health con las dos dependencias arriba**: `curl -A "Mozilla/5.0" -w '%{time_total}\n' -o - https://api.clubio.lat/api/health`
   -> `{"status":"ok","db":"up","redis":"up"}`. `redis: up` es **la** prueba de que la red privada
   del Redis nuevo resuelve desde el backend movido; `db: up`, la de Neon.
3. **La misma medicion, el mismo harness**:
   `OUT=latencia-despues-region.json pnpm --filter @mi-saas/backend test:latencia` y comparar
   **minimo y mediana** contra la tabla de la seccion 1. Con las dos puntas en la misma region, cada
   endpoint deberia caer al piso de red + trabajo de CPU: esperar **health ~ 60-120 ms** y los
   endpoints de visita **~300-800 ms** en lugar de 1.2-2.4 s.
4. **Flujo real, no fabricado**: el harness `test:latencia` ejecuta el camino completo
   (`solicitar` -> `aprobar` -> `estado` -> `mi-tarjeta`) contra prod, con un cliente descartable que
   borra en el `finally`. Ese es el "apretar el boton", no un estado sembrado.
5. **Regresion**: los harness de push/perfil/cliente (`test:premios-push`, `test:disparos-push`,
   `test:campanas-push`, `test:envios-push`, `test:perfil-cliente`, `test:cumpleanos`,
   `test:acepta-notificaciones`, `test:acepta-notificaciones-default`) y el flujo de visita
   (`test:visita-pedido`, `test:editar-monto`, `test:hibrido`, `test:ws-cancelado`). El corte de
   "hoy" del limite diario usa la hora del contenedor (UTC, no depende de la region), asi que **no**
   hay que esperar cambios de fecha por la mudanza.

## 6. Riesgos

1. **La red privada de Railway NO cruza regiones (el riesgo grande).** `REDIS_URL` apunta a
   `<servicio>.railway.internal`, que solo resuelve **dentro de la misma region**. Si se mueve el
   backend y el Redis se queda en `sfo`, el backend **no arranca**: BullMQ/Redis tira
   `ENOTFOUND`/`ECONNREFUSED` (o `WRONGPASS` si algo responde), el healthcheck no pasa y el deploy
   queda `FAILED` — y como un `FAILED` no reemplaza al contenedor sano, el sintoma visible es
   **"el cambio no tomo"**, no una caida. Por eso el Redis (o su reemplazo) se mueve **en la misma
   ventana** que el backend.
2. **El volumen del Redis es region-bound**: mover el servicio implica **volumen nuevo y datos
   vacios**. El cache se reconstruye solo; las **colas de BullMQ no**: lo encolado y no procesado se
   pierde (notificaciones push pendientes). Drenar antes.
3. **`${{servicio.VAR}}` interpolado dentro de una URL no se resuelve** (caso real: `WRONGPASS` con
   la referencia textual como password). Escribir el valor explicito y verificar desde los **logs del
   servicio**, no desde el visor de variables.
4. **Neon no cambia de region un proyecto existente** (Variante B): es crear + migrar, con el riesgo
   propio de una migracion de datos (secuencias, extensiones, `_prisma_migrations`) y una ventana de
   solo-lectura o de replicacion.
5. **Caches y propagacion**: la config que consume el cliente tiene `revalidate: 30` y la config
   efectiva del backend tiene TTL 5 min (memoria + Redis). Despues de la mudanza, la primera vuelta
   es fria: medir despues del primer minuto, no en el primer segundo.
6. **Cloudflare/edge**: el dominio de la API esta proxeado; tras la mudanza las primeras respuestas
   son frias (un pico de un solo hit). No confundirlo con una regresion.
7. **Plan/cuota de Railway**: crear un servicio y un volumen nuevos puede toparse con el limite del
   plan (`Free plan resource provision limit exceeded`). Verificar `subscriptionType` /
   `subscriptionPlanLimit` **antes** de la ventana.
8. **CORS y dominios**: mover de region **no** cambia dominios ni CORS (son de la app, no del
   hosting). Lo unico que cambia es el hop interno PWA(SSR)→API si las apps se quedan atras.
9. **Lo que NO se rompe por la region**: la hora del contenedor es UTC en cualquiera de las dos
   regiones, asi que los cortes de "hoy" (limite diario, cumpleanos, ventanas de push) no cambian.

## 7. Rollback

- **Railway conserva el deployment anterior.** Si el backend no pasa el healthcheck, el contenedor
  viejo sigue sirviendo: el rollback de la app es **re-deployar el deployment anterior** (dashboard →
  Deployments → el `SUCCESS` previo → Redeploy), y el de la region,
  `serviceInstanceUpdate({ region: <la vieja> })` + redeploy.
- **El Redis viejo no se borra**: se descomisiona recien cuando la mudanza lleva dias estable. Si hay
  que volver, se revierte `REDIS_URL` al DNS viejo **y** la region del backend **en la misma pasada**
  (misma razon que el riesgo 1: no pueden quedar en regiones distintas).
- **Variante B**: `DATABASE_URL`/`DIRECT_URL` vuelven al proyecto Neon viejo (que se deja intacto) y
  se redeploya. La ventana de rollback es mientras el proyecto viejo siga existiendo.
- **Tiempo esperado por paso de rollback**: un ciclo de deploy (~3-5 min por servicio).
- **Antes de dar por buena la mudanza**: correr `test:latencia` y los harness de la seccion 5, y
  comparar contra la tabla de la seccion 1 (y contra `latencia-antes-region.json`).
