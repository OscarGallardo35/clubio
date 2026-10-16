# Mover la base de Neon de `sa-east-1` (San Pablo) a Estados Unidos

> **Documento de INVESTIGACION. No se ejecuto nada de esto.** No se creo ningun proyecto Neon, no se
> toco la base de produccion, no se cambio ninguna variable ni se deployo nada. Lo unico que se hizo
> contra la base de produccion fueron **lecturas** (`SELECT` de conteos y metadatos) para tener los
> numeros reales que aparecen mas abajo. Complementa a `docs/plan-region-backend.md` (que describe la
> variante B a grandes rasgos): este archivo la baja a procedimiento concreto y contesta la pregunta
> "¿hay una forma simple, idealmente por API, de mudar la region?".

## 0. Veredicto en una linea

**No hay una forma 100% API, pero tampoco hace falta un procedimiento artesanal de horas**: Neon
**no permite cambiar la region de un proyecto existente** ni tiene endpoint para importar un dump
(la region se fija al crear el proyecto), asi que el camino es **crear un proyecto nuevo eligiendo
region por API/CLI** (`region_id: "aws-us-west-2"`, lo mas cercano a Railway `sfo`) y **copiar los
datos con `pg_dump` + `pg_restore` scripteados** — como esta base pesa **17 MB**, eso es una ventana
de corte de **minutos**, repetible de punta a punta con un script, y el proyecto viejo queda intacto
como rollback.

## 1. Lo que hay hoy en la base (medido, no supuesto)

Lectura de solo lectura contra produccion el **2026-10-16** (rol `admin_role`, base `neondb`):

| Metrica | Valor |
|---|---|
| Host (enmascarado) | `ep-purple-mode-****-pooler.c-2.sa-east-1.aws.neon.tech` (pooler) / `ep-purple-mode-****.c-2.sa-east-1.aws.neon.tech` (directa) |
| Region | `sa-east-1` (AWS South America East 1, San Pablo) |
| Version de Postgres | **18.6** |
| Tamano de la base | **17 MB** (`pg_database_size`) |
| Tablas en `public` | **48** (45 modelos de Prisma + `_prisma_migrations` + `_ItemCartaGrupoModificador` (tabla puente implicita) + `playing_with_neon`, el sobrante de Neon) |
| Tablas con RLS | 22 · **policies: 44** |
| Migraciones en `_prisma_migrations` | 20 filas = **18 aplicadas** + 2 revertidas (los reintentos de `hibrido_puntos` y `metodo_visita_pedido`). Hay **18 carpetas** en `prisma/migrations` → coincide |
| Secuencias en `public` | **1** (`playing_with_neon_id_seq`) — **no hay ninguna columna `autoincrement`**: todos los ids son `cuid()` |
| Extensiones | solo `plpgsql` |
| Dueno de las 48 tablas | **`admin_role`** (el problema de ownership que describe `BACKEND_PLAN.md` ya esta resuelto: se transfirio la propiedad) |
| Roles | `admin_role`, `app_user`, `migration_role` (creados por `prisma/rls.sql`), `neondb_owner` (el de Neon). `admin_role` tiene **CREATE** sobre `public` y `neondb_owner` es miembro de los tres |
| Filas de las tablas criticas | `Negocio` 3 · `Cliente` 43 · `Visita` 21 · `Pedido` 43 · `PremioOtorgado` 7 · `TokenValidacion` 11 · `EventoAuditoria` 2784 · `NotificacionPush` 3 |
| Ultima escritura | `Visita.aprobadoEn` = 2026-10-16 13:57 UTC · `Pedido.creadoEn` = 2026-10-14 16:17 UTC |

Dos consecuencias que cambian el plan respecto de lo que dice `plan-region-backend.md`:

1. **No hay secuencias que re-sincronizar**: los ids son `cuid()` (strings generados en la app), asi
   que el clasico "despues del `pg_restore` las secuencias quedan atras" **no aplica**. La unica
   secuencia que existe es la del sobrante `playing_with_neon`.
2. **Las tablas las tiene `admin_role`, y `admin_role` es un rol creado por SQL** (no es miembro de
   `neon_superuser`). Eso obliga a un orden concreto en el destino: **crear los roles ANTES del
   `pg_restore`** (el dump trae `GRANT`/`CREATE POLICY ... TO app_user` y fallaria con
   `role "app_user" does not exist`), y **restaurar como `neondb_owner`**.

## 2. Que permite (y que no) la API publica de Neon

Base URL documentada: **`https://console.neon.tech/api/v2`** (con `Authorization: Bearer $NEON_API_KEY`).
Ojo: `https://api.neon.tech` —el que aparece en algunos ejemplos viejos— **no responde** (probado: sin
respuesta; `console.neon.tech/api/v2/regions` responde `401` sin token, o sea que existe).

### 2.1 Cambiar la region de un proyecto existente: **NO**

> "Each Neon **project** exists in exactly one region. (...) **You cannot change the region** for an
> existing project. If you need your **data** in a different region, you **create a new Neon
> project** in that region and **migrate your database** there. You are not moving the project;
> region is fixed when the project is created."
> — <https://neon.com/docs/introduction/regions>

Neon tiene una pagina dedicada al tema (`Region migration`) que justamente asume eso y ofrece tres
caminos: Import Data Assistant, `pg_dump`/`pg_restore` y replicacion logica:
<https://neon.com/docs/import/migrate-neon-to-another-region>

### 2.2 Crear un proyecto eligiendo region: **SI** (y es lo unico que hace falta del lado "API")

`POST /projects` con `{"project":{"name":..., "region_id":"aws-us-west-2", "pg_version":18}}`
(<https://neon.com/docs/reference/api/projects/create-project>). Identificadores de region vigentes
(<https://neon.com/docs/introduction/regions>), y los que devuelve el endpoint de lectura
`GET /regions`:

| `region_id` | Donde |
|---|---|
| `aws-us-east-1` | N. Virginia (default de la cuenta) |
| `aws-us-east-2` | Ohio |
| **`aws-us-west-2`** | **Oregon** |
| `aws-eu-central-1` / `aws-eu-west-2` | Frankfurt / Londres |
| `aws-ap-southeast-1` / `aws-ap-southeast-2` | Singapur / Sydney |
| `aws-sa-east-1` | San Pablo (la actual) |

**Cual conviene: `aws-us-west-2` (Oregon).** Railway **no tiene region en Sudamerica** —sus cuatro
regiones son US West, US East, Europe West, Asia Southeast
(<https://docs.railway.com/networking/edge-networking>) y la region `sfo` del proyecto es
**San Francisco, California**, hoy con identificador `us-west2` (`sfo` es un identificador viejo de
Railway: "sfo is a legacy identifier; open the service settings and select US West Metal (California,
us-west2)"). Neon no tiene region en California, asi que **la mas cercana es Oregon**. Lo confirma un
tercero que empaqueta las dos cosas: Mastra mapea Railway `sfo` (San Francisco) → Neon
`aws-us-west-2` (Oregon) (<https://mastra.ai/docs/mastra-platform/regions>).

Esperar, entonces: el viaje backend→base pasa de **200-450 ms** (San Francisco ↔ San Pablo) a algo del
orden de **10-25 ms** (San Francisco ↔ Oregon, cruce de region AWS costa oeste). Es una mejora de un
orden de magnitud, no el ~1 ms de compartir region. **Ese numero (10-25 ms) es estimacion, no medicion**
—no se puede medir sin crear el proyecto— y conviene medirlo con `test:latencia` el dia de la prueba.

### 2.3 Endpoints utiles (todos existen, verificados contra el indice de la referencia)

| Que | Endpoint | Sirve para |
|---|---|---|
| Listar regiones (por organizacion) | `GET /regions?org_id=...` | saber que regiones te ofrece tu plan/org |
| Crear proyecto | `POST /projects` (`region_id`, `pg_version`, `org_id`) | **crear el destino** |
| Leer proyecto | `GET /projects`, `GET /projects/{id}` | leer `region_id`, `pg_version`, `settings` |
| Actualizar proyecto | `PATCH /projects/{id}` | `settings.enable_logical_replication`, `history_retention_seconds`, `allowed_ips` |
| Connection string | `GET /projects/{id}/connection_uri` | sacar la cadena del destino |
| Ramas | `POST /projects/{id}/branches` (con `parent_id`, `parent_timestamp`) | ramas / branching por tiempo |
| Restore a un punto en el tiempo | `POST /projects/{id}/branches/{branch_id}/restore` (`source_timestamp`/`source_lsn`, `preserve_under_name`) | volver atras **dentro del mismo proyecto** |
| Snapshots | `POST /projects/{id}/branches/{branch_id}/snapshot` + `POST /projects/{id}/snapshots/{snapshot_id}/restore` (beta) | red de seguridad antes de tocar nada |
| Crear base / roles / reset de password | `POST /projects/{id}/branches/{bid}/databases`, `.../roles`, `.../roles/{role}/reset_password` | preparar el destino |
| Borrar proyecto | `DELETE /projects/{id}` | descomisionar el viejo |
| Recuperar un proyecto borrado | `POST /projects/{id}/recover` (ventana de 7 dias) | ultima red de seguridad |

CLI (paquete `neon`, `npm i -g neon`): `neon projects create --name X --region-id aws-us-west-2
--pg-version 18`, `neon projects list`, `neon connection-string --project-id X --role-name
neondb_owner` (agrega `--pooled` para la del pooler; por defecto da la **directa**), `neon projects
update <id> --enable-logical-replication`, `neon branches create/restore`, `neon snapshots restore`.
Terraform (`neon_project`, provider `kislerdm/neon`) sirve **solo para aprovisionar**: crea el
proyecto en la region que le pidas, pero **no mueve datos**.

### 2.4 Lo que NO existe en la API (verificado)

- **Mover la region de un proyecto**: no existe endpoint.
- **Importar un dump / "import from connection string"**: **no hay ningun endpoint de import** en la
  API publica. Grepeando el indice completo de la referencia (`https://neon.com/docs/reference/api.md`)
  no hay ni una ruta con "import": lo unico parecido es `POST /projects/{id}/recover` (recuperar un
  proyecto borrado). El **Import Data Assistant** es **solo consola**.
- **Restaurar un PITR o un snapshot en OTRO proyecto (y por lo tanto en otra region)**: no. Tanto
  `POST /projects/{pid}/branches/{bid}/restore` como `POST /projects/{pid}/snapshots/{sid}/restore`
  cuelgan de un proyecto y crean la rama **dentro de ese proyecto**; el `snapshot_id` pertenece a ese
  proyecto. La region es del proyecto, asi que un restore **no** cambia de region.
- **Clonar un proyecto**: no hay endpoint de clonado (si hay `POST /organizations/{org}/projects/transfer`,
  que mueve un proyecto **entre organizaciones**, sin cambiar la region).

## 3. Comparacion de opciones

| # | Opcion | Como se hace | API o consola | Downtime | Riesgo | ¿Scripteable? |
|---|---|---|---|---|---|---|
| 0 | Cambiar la region del proyecto actual | — | — | — | — | **No existe** (documentado) |
| 1 | **`pg_dump` + `pg_restore` a proyecto nuevo** (recomendada) | crear proyecto por API/CLI en `aws-us-west-2`; `pg_dump -Fc` del origen (URL directa) y `pg_restore` en el destino (URL directa) | **API/CLI** para crear; `pg_dump`/`pg_restore` en tu maquina (no vienen instalados) | **Corte de escritura ~1-3 min** (17 MB + verificacion) + redeploy del backend (~3-5 min) | Bajo-medio: los gotchas son roles/permisos y no olvidarse `_prisma_migrations` (van solos en el dump) | **Si, de punta a punta** una vez instalado el cliente de Postgres |
| 2 | **Import Data Assistant** (consola) | Console → Projects → "Import Data Assistant": le das la cadena **directa** del origen, corre checks, **crea el proyecto destino en la region que elijas** e importa | **Consola** (no hay endpoint) | Bajo: corre en paralelo, `Run Checks` y copia; **limite de 1 hora** para la operacion | Beta, requiere que la base sea **< 10 GB** (la nuestra: 17 MB ✔) y que pase el chequeo de version/extensions. La doc de los checks habla de **Postgres 14-17** y nosotros estamos en **18.6** → **verificar antes** | **No** |
| 3 | **Replicacion logica** Neon→Neon (publicacion/suscripcion) | `PATCH /projects/{pid}` con `settings.enable_logical_replication: true` (o `neon projects update --enable-logical-replication`) en el ORIGEN; `CREATE PUBLICATION` en el origen; **mismo schema** en el destino; `CREATE SUBSCRIPTION` con la cadena directa del origen; `switchover` cuando esta al dia | **API/SQL** (todo automatizable) | **Casi cero**: se corta solo el switchover | **Medio-alto**: `wal_level=logical` **no se puede revertir** y reinicia los computes del origen; hay que preparar el schema aparte (DDL no se replica); Neon borra slots inactivos a las ~40 h; mientras hay subscriptor el compute del origen **no duerme** (se paga siempre); `max_replication_slots = 10` | Si (SQL + API), pero mas piezas |
| 4 | `pgcopydb` (paraleliza el dump/restore) | `PGCOPYDB_SOURCE_PGURI` / `PGCOPYDB_TARGET_PGURI` + `pgcopydb clone --no-owner --no-acl` | CLI, pero **no esta instalado** | igual a la 1 (un poco menos) | Bajo, pero para 17 MB **no aporta nada**: la opcion 1 ya tarda segundos. `--follow` (replicacion) **no esta soportado en Neon** | Si |
| 5 | Terraform | recrear el proyecto como codigo | API | el de la migracion que le pongas al lado | No mueve datos: es aprovisionamiento. Sirve si quieren dejar el proyecto destino versionado | Parcial |
| 6 | Restore de PITR / snapshot a otro proyecto-otra region | — | — | — | — | **No existe** (el restore es intra-proyecto) |

## 4. Procedimiento recomendado (opcion 1), paso a paso

> Antes de tocar produccion: **correr todo el flujo contra un proyecto de prueba** (pasos 2 a 7 con
> una copia descartable) y recien despues hacerlo en serio. El destino de prueba se borra con
> `DELETE /projects/{id}`.

### Paso 0 — Prerrequisitos (una sola vez)

1. **API key de Neon** (Consola → Account settings → API keys). Se usa solo por variable de entorno:
   `export NEON_API_KEY='...'` — **no se commitea ni se pega en el repo**.
2. **Cliente de Postgres 18 a mano.** Verificado en esta maquina: **no hay `psql` ni `pg_dump`**
   instalados. `pg_dump`/`pg_restore` necesitan la misma major que el servidor (18). Opciones:
   `winget install PostgreSQL.PostgreSQL.18` (o el binario "PostgreSQL 18 client" / `scoop install
   postgresql`), o Docker (`docker run --rm -v "$PWD:/d" postgres:18-alpine pg_dump ...`).
   *Neon no puede hacer el dump por vos*: no hay `pg_dumpall`, ni `-C/--create`, ni acceso a
   filesystem (<https://neon.com/docs/import/migrate-from-postgres>).
3. **Las dos cadenas directas (sin pooler)**. La del formato viejo esta en `.env` (`DIRECT_URL`,
   host sin `-pooler`). La nueva sale del proyecto destino (paso 2). **Nunca al chat ni al repo.**
4. **Requisito del cliente**: que el dump salga de la URL **directa**, no del pooler
   ("Avoid using `pg_dump` over a pooled connection string", `migrate-from-neon`).

### Paso 1 — Red de seguridad en el proyecto actual (API, sin downtime)

```bash
# 1) anotar el estado actual (sin secretos: ids, region, pg_version)
curl -s "https://console.neon.tech/api/v2/projects" -H "Authorization: Bearer $NEON_API_KEY" \
  | jq '.projects[] | {id, name, region_id, pg_version}'

# 2) snapshot del branch principal (beta, pero es lo que hay por API)
curl -s -X POST "https://console.neon.tech/api/v2/projects/$ORIGEN_ID/branches/$BRANCH_ID/snapshot?name=pre-mudanza-us" \
  -H "Authorization: Bearer $NEON_API_KEY"
```

Alternativa sin snapshot: la ventana de instant restore del plan (Free: 6 h; Launch: 7 dias) alcanza
para volver atras dentro del mismo proyecto.

### Paso 2 — Crear el proyecto destino en Oregon (API o CLI)

```bash
# por API
curl -s -X POST "https://console.neon.tech/api/v2/projects" \
  -H "Authorization: Bearer $NEON_API_KEY" -H "Content-Type: application/json" \
  -d '{"project":{"name":"clubio-prod-usw2","region_id":"aws-us-west-2","pg_version":18,"org_id":"'$ORG_ID'"}}' \
  | tee /tmp/neon-destino.json | jq '{id: .project.id, region: .project.region_id, pg: .project.pg_version, uri: .connection_uris[0].connection_uri}'

# o por CLI (equivalente)
neon projects create --name clubio-prod-usw2 --region-id aws-us-west-2 --pg-version 18 --output json
```

- Con API key **personal** hay que pasar `org_id`; con API key de organizacion se infiere.
- `pg_version: 18` **a proposito**: igualar la del origen evita sumarle a la mudanza el riesgo de un
  upgrade de Postgres.
- El proyecto nuevo trae por defecto: rama `main`, base `neondb`, rol `neondb_owner` y un compute
  read-write. La region se fija aca y **no se cambia mas**.

```bash
# las dos cadenas del destino (directa y pooled)
NEW_DIRECT=$(neon connection-string --project-id "$DESTINO_ID" --role-name neondb_owner --database-name neondb)   # directa
NEW_POOLED=$(neon connection-string --project-id "$DESTINO_ID" --role-name neondb_owner --database-name neondb --pooled)
```

### Paso 3 — Crear los roles en el destino ANTES del restore (como `neondb_owner`)

Esto no lo hace el `pg_dump` (los roles son del cluster, no de la base). Correr en el destino, como
`neondb_owner`, con **la misma password que usa la app** para `admin_role` (la del `.env`; si prefieren
rotarla, se rota en los dos lados y se actualiza Railway — nunca en texto plano en un archivo versionado):

```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='app_user') THEN
    CREATE ROLE app_user WITH LOGIN PASSWORD 'CAMBIAR_EN_PRODUCCION';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='admin_role') THEN
    CREATE ROLE admin_role WITH LOGIN PASSWORD 'CAMBIAR_EN_PRODUCCION' BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='migration_role') THEN
    CREATE ROLE migration_role WITH LOGIN PASSWORD 'CAMBIAR_EN_PRODUCCION' BYPASSRLS;
  END IF;
END $$;

-- Igual que produccion hoy (medido: admin_role puede crear en public)
GRANT CREATE, USAGE ON SCHEMA public TO admin_role;
GRANT USAGE ON SCHEMA public TO app_user, migration_role;
```

Como `neondb_owner` **crea** esos roles, queda automaticamente como miembro (con `ADMIN OPTION`), que
es justo lo que hace falta despues para transferir la propiedad de las tablas.

### Paso 4 — Dump del origen (con la app andando, sin cortar)

```bash
STAMP=$(date +%Y%m%d-%H%M)
pg_dump -Fc -v --no-owner --no-blobs \
        -d "$ORIGEN_DIRECT_URL" \
        -f "clubio-$STAMP.dump"
ls -lh "clubio-$STAMP.dump"    # ~17 MB: tiene que pesar parecido a la base
```

Notas: `-Fc` = formato custom (lo que come `pg_restore`); `--no-owner` evita los `ALTER ... OWNER TO`
del dump (los resolvemos a mano en el paso 6); `--no-blobs` porque Neon no soporta large objects.
**La tabla `_prisma_migrations` va incluida** (es una tabla mas de `public`): sin eso Prisma no sabe
que migraciones ya corrieron. No usar `pg_dumpall` ni `-C`.

### Paso 5 — Restore en el destino (como `neondb_owner`)

```bash
pg_restore -v --no-owner --no-tablespaces \
           -d "$NEW_DIRECT" \
           "clubio-$STAMP.dump" 2>&1 | tee restore.log
grep -iE "error|warning" restore.log | grep -viE "does not exist, skipping" || echo "restore sin errores nuevos"
```

Corre como `neondb_owner` (el unico con CREATE sobre `public` y con membresia en `neon_superuser` en
un proyecto nuevo). Errores de `ALTER OWNER` no aplican porque el dump se hizo con `--no-owner`.

### Paso 6 — Reconstruir permisos, RLS y ownership en el destino

El dump trae las **policies** (`CREATE POLICY`), pero no los `GRANT` de las secuencias ni el ownership.
Lo mas limpio: correr el `apps/backend/prisma/rls.sql` completo **en el destino** (es idempotente:
usa `DO $$ ... IF NOT EXISTS` para los roles y `DROP POLICY IF EXISTS` + `CREATE POLICY`), y despues
espejar el estado medido de produccion (tablas propiedad de `admin_role`):

```sql
-- como neondb_owner, despues del restore y del rls.sql
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO admin_role', r.tablename);
  END LOOP;
  FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname='public' LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO admin_role', r.sequencename);
  END LOOP;
END $$;

GRANT CREATE, USAGE ON SCHEMA public TO admin_role;
```

> `rls.sql` crea los roles con la password placeholder `CAMBIAR_EN_PRODUCCION`: si los creaste en el
> paso 3 con la password real, el `DO $$` los saltea y no la pisa. **Verificar despues** con
> `SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname IN ('admin_role','app_user','migration_role');`

### Paso 7 — Verificacion de la copia (antes de tocar Railway)

**Aca termina la etapa "sin riesgo".** Si algo no cierra, se borra el proyecto destino y no paso nada.

```bash
# huella comparable de las dos bases (script completo en la seccion 5)
./huella.sh "$ORIGEN_DIRECT_URL" origen.txt
./huella.sh "$NEW_DIRECT"       destino.txt
diff -u origen.txt destino.txt && echo "HUELLA IGUAL -> listo para el corte"
```

Chequeos, en orden de importancia:

1. **Conteos exactos de las 48 tablas** (no de "las criticas" solamente): el generador de la seccion 5
   las cuenta todas con una sola query. Criticas: `Cliente`, `Visita`, `Pedido`, `PremioOtorgado`,
   `TokenValidacion`, `EventoAuditoria` (hoy: 43 / 21 / 43 / 7 / 11 / 2784).
2. **`_prisma_migrations` completo**: `count(*)` con `finished_at IS NOT NULL AND rolled_back_at IS
   NULL` = **18** (hoy: 18 aplicadas + 2 revertidas = 20 filas). Mejor aun, la prueba de fuego:
   ```bash
   DIRECT_URL="$NEW_DIRECT" pnpm --filter @mi-saas/backend exec prisma migrate deploy --schema prisma/schema.prisma
   # esperado: "No pending migrations to apply."
   ```
3. **Ultimas filas por fecha**: `max("aprobadoEn")` de `Visita` y `max("creadoEn")` de `Pedido`
   tienen que ser **iguales** en las dos bases (hoy: `2026-10-16 13:57:33.505` y
   `2026-10-14 16:17:59.011`). Si el destino tiene una fecha **mas vieja**, el dump es de antes y hay
   que rehacerlo.
4. **RLS**: 22 tablas con `relrowsecurity` y **44 policies** en el destino.
5. **Ownership y roles**: 48 tablas con `tableowner = admin_role`, y los 3 roles existiendo con
   `BYPASSRLS` donde corresponde.
6. **Secuencias**: no hay ninguna que sincronizar (todos los ids son `cuid()`). La unica,
   `playing_with_neon_id_seq`, es del sobrante de Neon — vale la pena **no copiar `playing_with_neon`**
   (`pg_dump -T playing_with_neon`) y aprovechar para limpiar esa deuda.
7. **Escritura real, no sintetica** (esto es lo que de verdad prueba que quedo usable): despues del
   corte, correr los harness del repo contra el nuevo destino. Los baratos cubren todo el camino:
   `pnpm --filter @mi-saas/backend test:latencia` (crea un cliente descartable y lo borra en el
   `finally`), `test:perfil-cliente`, `test:visita-pedido`.
8. **`DATABASE_URL` con el pooler correcto**: en el destino, la pooled es
   `...-pooler.c-N.us-west-2.aws.neon.tech` y la directa no lleva `-pooler`. Prisma usa
   `DATABASE_URL` (pooler) para la app y `DIRECT_URL` (directa) para migraciones: **las dos se
   cambian**, con el mismo query string que hoy (`?sslmode=require&channel_binding=require`).

### Paso 8 — El corte: apuntar Railway al proyecto nuevo

1. **Ultimo dump incremental** si hubo escrituras desde el paso 4 (con 17 MB: repetir el paso 4+5,
   o solo las tablas que cambiaron con `-t` y `--data-only`).
2. **Freeze de escritura** (la app sigue leyendo; si el trafico nocturno es nulo, alcanza con hacerlo
   a las 03:00 ART).
3. **Cambiar las dos variables** en el servicio `backend` de Railway: `DATABASE_URL` (pooled del
   destino) y `DIRECT_URL` (directa del destino). Por dashboard, o por API (Railway GraphQL
   `variableUpsert` + `serviceInstanceRedeploy`, como ya usa `docs/plan-region-backend.md`).
4. **Redeploy** del backend (~3-5 min). El resto de los servicios no se toca: Neon es TCP publico con
   TLS, **no hay red privada entre Railway y Neon**, asi que la region de Railway no cambia y las PWA
   tampoco.
5. **Verificar** (paso 9) y recien ahi soltar el freeze.

### Paso 9 — Verificacion post-corte

```bash
curl -sA "Mozilla/5.0" -w '\n%{time_total}s\n' https://api.clubio.lat/api/health
# esperado: {"status":"ok","db":"up","redis":"up"}

OUT=latencia-despues-neon-us.json pnpm --filter @mi-saas/backend test:latencia
# comparar minimo y mediana contra los numeros de docs/plan-region-backend.md
```

Ojo con la lectura del resultado: **el tramo navegador→API no mejora** (Argentina→San Francisco sigue
siendo ~180 ms); lo que baja es **backend→base**. Si el objetivo es "que el cliente del local lo
sienta", esta mudanza **no** lo resuelve: eso es la variante A del otro documento (mover Railway, que
no tiene region en Sudamerica → hoy no es posible).

## 5. Script de verificacion (copiar y pegar)

`huella.sh`: imprime una huella comparable de una base (conteos exactos de todas las tablas de
`public` + metadatos + ultimas escrituras). Sirve para origen y destino, y para el dia del corte.

```bash
#!/usr/bin/env bash
# huella.sh <connection-string> <archivo-salida>
# Requiere psql (el cliente de Postgres). Solo lectura.
set -euo pipefail
URL="$1"; OUT="${2:-huella.txt}"
psql_run() { psql "$URL" -At -v ON_ERROR_STOP=1 -c "$1"; }

{
  # 1) conteos exactos de TODAS las tablas de public (una query generada)
  SQL=$(psql_run "SELECT string_agg(format('SELECT %L||'' = ''||count(*) FROM %I.%I', tablename, schemaname, tablename), ' UNION ALL ' ORDER BY tablename)
                 FROM pg_tables WHERE schemaname='public'")
  psql_run "$SQL"

  # 2) metadatos del schema
  psql_run "SELECT 'tablas_public = '||count(*) FROM pg_tables WHERE schemaname='public'"
  psql_run "SELECT 'tablas_con_rls = '||count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relrowsecurity"
  psql_run "SELECT 'policies = '||count(*) FROM pg_policies WHERE schemaname='public'"
  psql_run "SELECT 'tablas_owner_'||tableowner||' = '||count(*) FROM pg_tables WHERE schemaname='public' GROUP BY tableowner"
  psql_run "SELECT 'roles = '||string_agg(rolname||'('||rolbypassrls::text||')', ',' ORDER BY rolname) FROM pg_roles WHERE rolname IN ('admin_role','app_user','migration_role')"
  psql_run "SELECT 'pg_version = '||current_setting('server_version')"

  # 3) migraciones de Prisma
  psql_run "SELECT 'prisma_migraciones_aplicadas = '||count(*) FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL"
  psql_run "SELECT 'prisma_migraciones_filas = '||count(*) FROM \"_prisma_migrations\""
  psql_run "SELECT 'prisma_ultima_migracion = '||max(finished_at)::text FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL"

  # 4) marcas de tiempo de las tablas que importan (si el destino tiene una fecha mas vieja, el dump es viejo)
  psql_run "SELECT 'visita_ultima = '||max(\"aprobadoEn\")::text FROM \"Visita\""
  psql_run "SELECT 'pedido_ultimo = '||max(\"creadoEn\")::text FROM \"Pedido\""
} | sed -E 's/[[:space:]]+$//' | sort -o "$OUT"
echo "huella escrita en $OUT ($(wc -l < "$OUT") lineas)"
```

Uso:

```bash
./huella.sh "$ORIGEN_DIRECT_URL" origen.txt
./huella.sh "$NEW_DIRECT"       destino.txt
diff -u origen.txt destino.txt          # vacio = copia fiel
```

### Huella de referencia del origen (medida el 2026-10-16)

El generador de conteos de arriba se **corrio contra produccion** (solo lectura) y devolvio las 48
tablas. Esta es la huella esperada en el destino el dia del corte:

```text
CampanaMarketing = 13
CampanaPush = 9
CheckinTurno = 0
Cliente = 43
ComunicacionMasiva = 0
ConfiguracionClub = 3
ConfiguracionSucursal = 0
DisparoPush = 2
DisparoPushLog = 0
DispositivoCliente = 0
Empleado = 8
EncargadoDia = 0
EnvioPushLog = 9
EventoAuditoria = 2784
EventoAuditoriaSuperAdmin = 494
ExcepcionHorario = 0
GrupoModificador = 4
Impersonacion = 0
IntegracionGoogle = 1
ItemCarta = 23
ItemCartaSucursal = 0
Lead = 0
Negocio = 3
NotificacionPush = 3
NotificacionPushEmpleado = 2
OpcionModificador = 13
Pedido = 43
PlanFeature = 57
PlantillaPush = 1
PremioOtorgado = 7
RegistroAcceso = 0
ReglaUpsell = 2
ResenaGoogle = 0
SesionDueno = 27
SesionEmpleado = 170
SesionSuperAdmin = 37
Sucursal = 4
SuperAdmin = 1
Suscripcion = 0
TarjetaClienteSucursal = 51
TokenValidacion = 11
Turno = 0
UsoMensual = 12
Visita = 21
WebhookLog = 0
_ItemCartaGrupoModificador = 4
_prisma_migrations = 20
playing_with_neon = 10
```

(Las tres unicas tablas que **no** son del modelo de negocio: `_prisma_migrations` (18 aplicadas + 2
revertidas), `_ItemCartaGrupoModificador` (tabla puente implicita de Prisma) y `playing_with_neon`
(el sobrante que deja Neon — mejor no copiarlo: `pg_dump -T playing_with_neon`).)

Si `psql` no esta instalado, la misma huella se puede sacar desde el **SQL Editor de la consola** de
cada proyecto (pegando las queries) o con `neon connection-string --psql -- -c '...'` — el CLI trae un
`psql` propio en TypeScript que **no requiere instalacion**.

Nota: `EventoAuditoria` va a crecer con cada request de la app, asi que diferencias de a 1-2 filas en
esa tabla (y en `_prisma_migrations`, si algo corrio una migracion) son **esperables** entre la
primera pasada y el corte. La huella que vale es la del **corte**: origen congelado vs destino.

## 6. Rollback y ventana

- **El proyecto viejo no se toca hasta una semana despues.** Mientras exista, el rollback es:
  devolver `DATABASE_URL` y `DIRECT_URL` al `sa-east-1` + redeploy del backend → **~3-5 min**.
- Las escrituras que entraron al proyecto nuevo despues del corte **no estan en el viejo**: para
  volver sin perderlas hay que copiarlas (dump de las tablas tocadas desde el viejo... en realidad
  desde el nuevo hacia el viejo) — es el unico punto realmente incomodo del rollback. Mitigacion: la
  ventana de exposicion es de minutos y en horario nocturno.
- Red de seguridad extra: un proyecto Neon **borrado se recupera dentro de los 7 dias**
  (`POST /projects/{id}/recover`, `neon projects recover`), asi que ni el borrado es definitivo.
- **Ventana de corte total: ~10-15 min** = 1-3 min de dump/restore + verificacion (segundos, la base
  son 17 MB) + 3-5 min de redeploy. El freeze de escritura real es de **1-3 min**.
- **Tiempo total del trabajo (no de la ventana): 2-4 h**, casi todo en preparar el cliente de
  Postgres, correr el flujo completo contra un proyecto de prueba, y el script de verificacion.

## 7. Lo que SI o SI pasa por la consola (no hay API)

| Cosa | Por que |
|---|---|
| **Import Data Assistant** | No tiene endpoint: es una herramienta de consola (y esta en beta). Todo el flujo guiado — checks, alta del proyecto destino, copia — es console-only |
| Crear la **API key** | La consola (o `neon auth`) |
| Elegir **organizacion / plan**, y ver el gasto | Consola / billing |
| Cambiar la **password** de `neondb_owner` (si hiciera falta) | Se puede por API (`reset_password`), pero la que muestra la consola es la via obvia |
| El **selector de region de la consola** | Es el camino sin API: el mismo `POST /projects` con `region_id` |

Todo lo demas del procedimiento recomendado (crear proyecto, connection strings, snapshot, borrar el
viejo, recuperarlo) **si** es API/CLI.

## 8. Costo y limites (lo que se puede afirmar y lo que no)

- **El plan actual no se puede leer desde el repo**: en `.env` / `.env.secrets` **no hay `NEON_API_KEY`**,
  asi que no pude consultar plan, org ni cuotas. Cuando la tengan, en 10 segundos:
  `curl -s "https://console.neon.tech/api/v2/organizations" -H "Authorization: Bearer $NEON_API_KEY"`.
- Por la doc de planes (<https://neon.com/docs/introduction/plans>): **Free = 100 proyectos** y **10
  ramas por proyecto**; Launch y Scale tambien 100 (Scale 1.000). O sea: **crear un segundo proyecto
  entra en cualquier plan**, incluido Free. (La doc se contradice entre "1 GB por proyecto" y "0.5 GB
  por proyecto" en Free; irrelevante: la base pesa 17 MB.)
- **Egress**: en Free son 5 GB/mes por proyecto; el dump + la verificacion mueven decenas de MB.
  En Launch/Scale, 500 GB incluidos.
- **El proyecto viejo puede quedar vivo como rollback**: si es Free, ojo con la politica de "proyectos
  Free inactivos por 90 dias son candidatos a borrado" (no aplica en una semana de rollback); si es
  pago, son centavos de storage por 17 MB (se cobra storage por GB-mes de **dato logico**, y el compute
  escala a cero a los 5 min).
- **El costo real de la opcion 3 (replicacion)** es distinto: mientras haya subscriptor, el compute del
  origen (San Pablo) **nunca duerme** → se paga ese compute todo el tiempo que dure la migracion.
- **Cuanto tarda la copia de este tamano**: segundos. 17 MB sobre TCP cross-continent van en el ruido.
  La demora del procedimiento **no** es de datos: es la instalacion del cliente y el redeploy.

## 9. Recomendacion final

1. **Hacer la mudanza con la opcion 1 (`pg_dump` + `pg_restore`)**. Es la unica que es simple, barata,
   verificable y **scripteable de punta a punta**, y con esta base implica minutos de corte.
2. **Orden sugerido**: (a) ensayo completo contra un proyecto de prueba en `aws-us-west-2` y borrarlo;
   (b) dejar el script `huella.sh` andando; (c) ventana real un dia de semana 03:00 ART con el dueno
   avisado; (d) dejar el proyecto viejo vivo 7 dias.
3. **La respuesta a "¿hay forma simple por API?"**: no hay endpoint de mudanza ni de import, pero el
   **aprovisionamiento y el cambio de cadena si son API**, asi que la mudanza queda **automatizable**
   (un script de ~60 lineas: crear proyecto → roles → dump → restore → huella → switch en Railway).
   El unico atajo "sin herramientas" es el **Import Data Assistant de la consola** (opcion 2), que hay
   que probar igual porque **la doc de sus checks habla de Postgres 14-17 y nosotros estamos en 18.6**.
4. **Esfuerzo**: 2-4 h de trabajo efectivo, ventana de corte 10-15 min, freeze de escritura 1-3 min.
   **Riesgo: bajo-medio** — el riesgo no es la copia (17 MB, verificable a nivel de conteo de todas las
   tablas) sino los detalles de permisos (roles creados por SQL, ownership de las 48 tablas) que **ya
   estan mapeados en este documento**; y el rollback es volver dos variables.
5. **Tener claro que esto NO arregla lo que siente el cliente**: la PWA sigue cruzando el continente
   para llegar a `api.clubio.lat`. Baja el reloj del backend, no el del mostrador.

## 10. Lo que NO se pudo verificar (a confirmar antes de ejecutar)

- **Que lista de regiones ofrece la org/plan**: `GET /regions` sin `org_id` devuelve las de la
  plataforma; con la API key se ve la real (la doc avisa que "not all regions are available to all
  organizations").
- **El plan actual y las cuotas** (no hay API key en el repo).
- **La latencia real San Francisco ↔ Oregon** (10-25 ms es estimacion): se mide con `test:latencia`
  el dia del ensayo, desde el backend.
- **Que el Import Data Assistant acepte un origen Postgres 18** (su doc dice 14-17).
- **Que `sfo` siga siendo el identificador con el que Railway muestra el servicio en el dashboard**:
  en la doc de Railway la region se llama **US West Metal / California / `us-west2`** y `sfo` figura
  como identificador **legado**; la ubicacion fisica (California) es lo que importa y esta confirmada,
  pero el string exacto conviene mirarlo en Settings del servicio.
- **Los parametros exactos de `GET /projects/{id}/connection_uri`** (la doc lista el endpoint; para
  sacar la cadena sin adivinar, usar `neon connection-string`).

## Fuentes

- Regiones de Neon (region fija al crear): <https://neon.com/docs/introduction/regions>
- Migrar a otra region de Neon (comparacion de los 3 caminos): <https://neon.com/docs/import/migrate-neon-to-another-region>
- Import Data Assistant (consola, < 10 GB, beta): <https://neon.com/docs/import/import-data-assistant>
- `pg_dump`/`pg_restore` (URL directa, sin `pg_dumpall`/`-C`): <https://neon.com/docs/import/migrate-from-postgres>
- Neon→Neon (`pg_dump | pg_restore`): <https://neon.com/docs/import/migrate-from-neon>
- Replicacion logica Neon→Neon: <https://neon.com/docs/guides/logical-replication-neon-to-neon>
- Replicacion logica en Neon (habilitarla por API, avisos): <https://neon.com/docs/guides/logical-replication-neon>
- API: crear proyecto (`region_id`) <https://neon.com/docs/reference/api/projects/create-project> ·
  regiones <https://neon.com/docs/reference/api/regions> · restore de rama
  <https://neon.com/docs/reference/api/branches/restore-project-branch> · snapshots
  <https://neon.com/docs/reference/api/snapshots>
- CLI `neon` (`projects create --region-id`, `connection-string`, `branches restore`, `snapshots`):
  <https://neon.com/docs/cli/projects>, <https://neon.com/docs/cli/connection-string>
- Planes y limites: <https://neon.com/docs/introduction/plans>
- Railway, regiones (4, ninguna en Sudamerica; `us-west2` = California):
  <https://docs.railway.com/deployments/regions>, <https://docs.railway.com/networking/edge-networking>
- Railway `sfo` = San Francisco (identificador legado) y su par Neon `aws-us-west-2`:
  <https://mastra.ai/docs/mastra-platform/regions>
- `pgcopydb` (y que `--follow` no esta soportado en Neon): <https://neon.com/docs/import/pgcopydb>
