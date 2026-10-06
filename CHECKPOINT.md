# CHECKPOINT — etapa 3 del QR #1 (UI del menu)

Sesion cortada a proposito por presupuesto de contexto, antes de arrancar `ImagenOptimizada`.
Nada quedo a medio escribir: el arbol esta limpio y todo lo que sigue esta verificado.

## Estado

- Rama `main`, local == remoto. Ultimo commit de codigo: `de98869`
  (grupo obligatorio de Salsas + script idempotente `apps/backend/scripts/agregar-grupo-salsas.cjs`).
- `/api/health` -> `{"status":"ok","db":"up","redis":"up"}`. Backend levantado desde Python con
  `DETACHED_PROCESS` (ver TROUBLESHOOTING: el terminal devolvia `stdin is not a tty` de forma
  intermitente cuando el comando encadenaba un `taskkill`).
- Datos: 1 negocio (`bar-la-esquina`), 2 sucursales (`centro` principal, `norte`),
  40 clientes (20 del seed + 20 de corridas de prueba; pendiente de limpieza pre-deploy).
- `menuActivo: true`, `tiposPedidoHabilitados: ['MESA','TAKEAWAY','DELIVERY']`,
  `sellosBienvenida: 1`, `permitirOverrideSucursal: true` (restaurados a sus valores originales).

## Los 3 puntos del orden que quedan

### 1. `ImagenOptimizada` en `@repo/ui` (opcion a, aprobada)

- `packages/ui/src/components/imagen-optimizada.tsx` + export en `index.ts`.
- Props: `src, alt, tipo ('item'|'avatar'|'logo'|'categoria'), aspectRatio, priority,
  className, fallbackIcon, placeholderColor`.
- `src` vacio -> placeholder con color de marca + icono. `src` externo -> `<img loading="lazy">`
  con `onError`. Cloudinary -> `c_fill, w_, q_auto:good, f_auto`.
- Stub guard para dev (mismo patron que `components/_stub.tsx`).
- Version SIMPLE: sin srcset ni AVIF (son del Prompt #5.9).

### 2. Punto 1 completo del plan de la etapa 3

- `modificadoresApi` en `apps/pwa-cliente/lib/api.ts` (patron de `upsellApi`: la ruta vive en
  la app, no en `@repo/api-client`, para no tocar el package).
- `lib/modificadores-cache.ts` puro: cache-first con TTL, mismo patron que `lib/carta-cache.ts`
  (`claveDeCarta`/`decidirLectura`/`planDeFetch` + reducer). **Normalizar `precioExtra` a
  number al entrar**, no en el modal.
- `stores/modificadoresStore.ts` (en memoria) + `hooks/useModificadores.ts`.
- `scripts/check-menu.mts` con las aserciones del cache y de la normalizacion; registrar
  `check:menu` en el `package.json` de la app.
- Extra propuesto y no confirmado: una asercion que pegue contra los endpoints reales y verifique
  que los campos monetarios lleguen como `number` (alarma contra un `Decimal` sin normalizar).

### 3. Verificacion completa

`build` PWA (aislado con `NEXT_DIST_DIR=.next-build` si el dev server esta vivo) + `typecheck`
+ los 8 checks + `/api/health`.

## Los 8 checks que deben pasar

| Check | Ultimo resultado |
|---|---|
| `pnpm check:packages` | EXIT 0 |
| `pnpm --filter @repo/validators check:validators` | 14 OK |
| `pnpm --filter pwa-cliente check:maquina` | 63 OK |
| `pnpm --filter pwa-cliente check:carrito` | 79 OK |
| `pnpm --filter pwa-cliente check:carta` | 38 OK |
| `pnpm --filter pwa-cliente check:upsell` | 42 OK |
| `pnpm --filter backend test:checklist` | EXIT 0 (16/16) |
| `pnpm --filter pwa-cliente check:flujo` | 25 OK (necesita backend y base arriba) |

`check:validators` vive en `@repo/validators`, no en la raiz. `check:carta` y `check:upsell` se
agregaron en este tramo (la lista paso de 6 a 8). `check:flujo` falla con 500 si la base esta
caida: no es una regresion.

## Formas reales ya verificadas (no volver a averiguarlas)

**`GET /carta?sucursalSlug=`** (200, requiere `X-Tenant-Slug`):
`{negocio, sucursal, total, categorias: [{categoria, items: [...]}]}`. Ojo: la clave de la
categoria es **`categoria`**, no `nombre`. Cada item:
`{id, categoria, nombre, descripcion, precio, precioBase, tieneOverride, disponible, etiquetas,
fotoUrl, orden}` — **`fotoUrl` existe** (no hay que tocar el backend) y `precio`/`precioBase`
llegan como **number**.

**`GET /modificadores/items/:itemId/grupos`** (200, publico). Devuelve un OBJETO, no un array:
```
{ itemId, itemNombre, precioBase,
  grupos: [ { id, nombre, descripcion, tipo, obligatorio, minSelecciones, maxSelecciones,
              opciones: [ { id, nombre, precioExtra, disponible } ] } ] }
```
`tipo` es `UNICA_SELECCION` o `MULTIPLE_SELECCION`. **`precioExtra` llega como STRING**
(`"0"`, `"200"`): es el `Decimal` de Prisma cruzando la API. Este es el caso vivo de la regla;
normalizar en el hook.

**`POST /upsell/calcular`**: body `{items:[{itemId,cantidad}], maxSugerencias?, sucursalId?,
sucursalSlug?}`. Responde `{sugerencias: [{reglaId, mensaje, motivo, item:{id,nombre,precio}}],
motivo}`. Con `Cafe expreso` devuelve 1 sugerencia real del seed (flan casero); con carrito
vacio, `{sugerencias: [], motivo: "sin reglas o carrito vacio"}`. `item.precio` llega como
**number**.

**Seed**: la Hamburguesa clasica tiene 2 grupos: `Aderezos` (MULTIPLE, obligatorio false, max 4)
y **`Salsas obligatorias`** (UNICA, obligatorio true, min/max 1, opciones Salsa de la casa 0 /
BBQ 200 / Sin salsa 0). El resto de los items con grupos (Milanesa, Bife) tienen UNICA no
obligatorio.

**`ImagenOptimizada` NO existe** en `@repo/ui` (por eso hay que construirla). `bottom-sheet.tsx`
si existe y es real (219 lineas, Radix Dialog + drag con framer-motion y `useReducedMotion`).
Los componentes sin implementar se generan con `components/_stub.tsx` y avisan por consola en
dev: al usar uno, confirmar que sea real.

## Reglas y hallazgos documentados en este tramo (ya en TROUBLESHOOTING.md)

- Verificar el CSS **servido**, no el HTML (el nombre de la clase esta en el markup aunque la
  regla no exista); las clases arbitrarias de Tailwind pueden no emitirse nunca.
- Verificar con un **valor distinto del que el codigo hardcodea**, o la verificacion es vacua;
  y capturar el valor original **antes** de mutarlo.
- Cuando hay banderas que deciden comportamiento, **el orden de los chequeos importa**; la
  politica en un solo lugar y el plan como traduccion.
- Un evento no puede usar el mismo campo como **discriminante y payload**.
- Los **`Decimal` de Prisma cruzan la API como string**; normalizar en el hook, no en cada
  consumidor.
- `git commit -F` para mensajes con comillas o caracteres especiales.
- Los e2e de sucursales se corren con `pnpm --filter backend test:e2e:s3|s4` (inyectan el `.env`).

## Pendientes anotados (no bloquean la etapa 3)

- **Pre-deploy**: sincronizar `seed.ts` con los grupos agregados por scripts (salsas
  obligatorias); limpiar o marcar los clientes de prueba; regenerar los 6 secretos JWT y los
  placeholders del `package.json` del backend.
- `e2e_s4.cjs` borra TODOS los overrides de la sucursal norte, no solo los suyos.
- Validators: migrar de listas `as const` a `z.nativeEnum` cuando se hagan Project References.
- `check:validators` todavia no cruza formas de campos, solo enums.
