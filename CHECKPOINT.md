# CHECKPOINT — PWA Cliente CERRADA · arrancando PWA Staff (Prompt #4)

Actualizado: 2026-10-06. Rama `main`, local == remoto (lo unico sin commitear es `.github/`, que el
push rechaza por scope: requiere `gh auth refresh -s workflow`).

## Estado por app

| Parte | Estado |
|---|---|
| **Backend** (NestJS 10 + Prisma + Neon + Redis) | Fases 1-8 + #3.0 **cerradas y verificadas e2e**. `/api/health` -> `{"status":"ok","db":"up","redis":"up"}` |
| **PWA Cliente** | **CERRADA y verificada.** QR #2 (club/visitas) y QR #1 (menu -> carrito -> checkout -> seguimiento) end-to-end. `/[tenant]/tarjeta` real |
| **PWA Staff** | solo `Dockerfile` + `package.json` + `railway.toml` (ya trae `dev: next dev -p 3002`). **Arrancando Fase 0/1** |
| **PWA Admin** | esqueleto; sin trabajo propio todavia |

## Como se levanta y se verifica (host Windows / git-bash)

- Backend: matar el proceso ANTES de `pnpm --filter backend build` (el `prebuild` hace `rimraf dist` y
  tumba el server que lo esta sirviendo). Despues: levantar y verificar `/api/health`.
  Se lanza desde Python con `DETACHED_PROCESS|CREATE_NEW_PROCESS_GROUP` (el terminal devuelve
  `stdin is not a tty` de forma intermitente).
- PWA Cliente: `:3001`. `next build` aislado con `NEXT_DIST_DIR=.next-build` si el dev server esta vivo.
- PWA Staff: `:3002` (`STAFF_APP_URL=http://192.168.0.103:3002` en `.env`; el link del mensaje de
  WhatsApp del staff apunta ahi, asi que la Staff TIENE que correr en ese puerto).
- IP de LAN: `192.168.0.103`.

## Los 7 checks de la PWA Cliente (todos verdes)

`carrito` 59 · `checkout` 115 · `menu` 95 · `visita-maquina` 84 · `upsell` 49 · `carta` 38 ·
`flujo-ws` 29. Mas `typecheck` 0 y `build` 0.

`check:flujo-ws` es **integracion**: pega al backend real de `:3000` y puede dejarlo caido (no es
determinista). Despues de correrlo, verificar `/api/health`.

Correr todo: `pnpm --filter pwa-cliente typecheck` · `node apps/pwa-cliente/scripts/check-<dominio>.mts`
· `pnpm --filter pwa-cliente build`.

## Commits recientes (los ultimos 14, reales)

```
b9b12ef feat(tarjeta): /[tenant]/tarjeta real (TarjetaSellos + banner de premio + estados)
973ecbc fix(club): el 401 es "falta sesion", no un rechazo del negocio
4712ff2 docs: corregir el corolario del harness (no es determinista)
5d62247 feat(checkout): auto-login del cliente + prellenado de nombre y telefono
3e73297 docs: corolario del harness de flujo
171f825 docs: regla del build del backend que mata el server que lo sirve
fa78887 fix(whatsapp): el boton abre WhatsApp (wa.me) y el mensaje pide verificar el pedido
699dcba fix(seguimiento): el 404 del endpoint publico tiene DOS significados
8dcb2c6 feat(seguimiento): olvidar el pedido cuando el link da 404
a387d5e fix(checkout): la navegacion al seguimiento sale del handler, no de un effect observador
a339aa9 temporal: diagnosticar el crash post-400
8b46728 feat(checkout): validar el telefono E.164 en el cliente antes del POST
54698ee docs: regla de las variables CSS inexistentes + TODO post-MVP del numero de pedido
aba2391 docs: regla de los tokens de color
```

## Decisiones de la PWA Staff (confirmadas por el usuario)

1. Se agrega `GET /auth/empleado/me` al backend (simetrico a `/auth/cliente/me`). **Bloqueante**:
   hoy el login solo devuelve la cookie y no hay forma de resolver la sesion.
2. **Sin `[tenant]` en la URL**: el negocio y la sucursal salen del token, no del path.
3. **Sucursal fija por token** (MVP). Cambio = re-login. TODO post-MVP: selector con header
   `X-Sucursal-Activa`.
4. Orden: **Fase 0** (backend `/me` + los 3 componentes de `@repo/ui`) -> **Fase 1** (esqueleto:
   login PIN + guard + nav de 4 tabs) -> Fase 2 Visitas (cierra el QR #2 end-to-end).

## Deuda tecnica anotada (no bloqueante)

- ⚠️ **RLS NO está activo.** Las politicas existen (`prisma/rls.sql`, 22 tablas / 44 politicas,
  todas con FORCE) pero la conexion usa `admin_role`, que tiene `rolbypassrls=true`, asi que las
  ignora. `withTenant()` no se llama nunca y `DATABASE_URL_ADMIN` no existe. **El aislamiento
  multi-tenant depende SOLO de los `where negocioId` del codigo.** TODO post-MVP: activar RLS de
  verdad (`app_user` + `withTenant` + `AdminPrismaService`). Detalle y evidencia en `BACKEND_PLAN.md`.
- ✅ **Auto-cancelado de PENDIENTE abandonados (opcion C del bug del 409): IMPLEMENTADO.** Un `@Cron`
  horario (`pedidos-auto-cancelar`) cierra los PENDIENTE con `creadoEn` de mas de 6 h: `CANCELADO` +
  `motivoRechazo: 'Auto-cancelado por inactividad'`, con el MISMO evento WS que el cancel manual
  (`pedido:cancelado`) y auditoria `pedido.auto_cancelado`. SOLO PENDIENTE, a proposito: `CONFIRMADO`
  significa que el local ya lo acepto (moverlo es su responsabilidad) y cancelar un ENVIADO en curso
  seria peor. Idempotente: cada pedido se cierra con un `updateMany` que exige `estado: PENDIENTE` en
  el WHERE, y sin candidatos no escribe ni loguea. El mismo metodo se corre a mano con
  `POST /pedidos/mantenimiento/auto-cancelar` (DUENO, y solo su negocio) — es lo que usa
  `test:auto-cancelar`. El 409 sigue devolviendo `linkVigente` y el checkout esconde "Ver mi pedido"
  si esta vencido (link vencido != pedido muerto).
  - **Deuda que queda (decision, no implementacion):** que hacer con un CONFIRMADO que quedo colgado
    >12 h. Hoy NO se toca: cerrarlo tendria que salir de una decision de negocio, no de un cron.
  - **Enhancement:** avisar al cliente ANTES de auto-cancelar (push/WhatsApp). Hoy se cancela en
    silencio porque el link ya vencio y no hay canal saliente.
- **Stubs exportados y sin implementar** en `@repo/ui`: `radio-group`, `checkbox`, `textarea`. El
  import compila y el fallo aparece en runtime. Se implementan en la Fase 0 (los necesita la Staff).
- `endpoints` de `@repo/api-client` **no tiene**: `auth.meEmpleado`, `pedidos.list/estado/tomar/
  cancelar/historial/estadisticas`, `visitas.misAprobaciones/historial`, `turnos.*`, `checkin.*`,
  `clientes.*`, `empleados.*`, `estadisticas.*`, `push.suscribirEmpleado`, `sucursales.configuracion`.
  Se agregan a medida que cada fase los necesita.
- `seed.ts` esta desincronizado (TODO pre-deploy). Limpiar los clientes de prueba antes de la demo
  (incluye `Oscar Gabriel` con telefono real y `Prueba Diagnostico` +5493585700001).
- Regenerar los 6 secretos JWT para produccion. Rotar la contrasena de Neon (quedo expuesta en el
  historial de la sesion, ya rotada >=2 veces).
- Placeholders `Tu nombre` / `UNLICENSED` en `apps/backend/package.json`.
- `brandingStore` persiste campos mutables: deberia persistir solo slug+id y refetchear con TTL.
- TODO post-MVP: `numero` real del pedido (distinto de `numeroAtendiente`).
- TODO pre-PWA-Admin: reemplazar los inputs nativos del `ModalModificadores` por los de `@repo/ui`.
- TODO post-etapa 4: `ErrorCarrito.codigo` -> union real.

## Credenciales (NUNCA commitear)

`.env`, `.env.secrets` y `apikeybdneon.txt` **no se commitean** (`.env.secrets` esta en `.gitignore`
linea 9). `.env.example` SI se commitea. Todo push pasa por el check anti-secretos.
