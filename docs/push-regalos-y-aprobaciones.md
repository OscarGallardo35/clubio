# Push, regalos y aprobaciones

Notas de producto y pendientes. Ultima actualizacion: 2026-10-09.

## Como funcionan hoy los flujos con aprobacion

Solo hay **dos** puertas de aprobacion en el producto, y las dos las genera el CLIENTE:

| Flujo | Lo genera | Lo aprueba | Si nadie aprueba |
|---|---|---|---|
| Visita QR #2 (sumar sello/puntos) | Cliente (`POST /visitas/solicitar`) | Staff, en `/visitas` o por el link `/validar` | El token vence a los 5 min; queda `EXPIRADA`, no acredita y hay que pedir otra |
| Pedido QR #1 | Cliente (`POST /pedidos`, PENDIENTE) | Staff (a CONFIRMADO, o RECHAZADO con motivo) | Un cron autocancela los PENDIENTE de mas de 6 h |

El **canje de premio es presencial** (lo ejecuta el mismo staff que lo entrega) y la **acreditacion al pasar a ENTREGADO** ocurre dentro de la misma transicion, sin segunda aprobacion.

## El regalo de un disparo NO espera aprobacion (verificado)

Los `DisparoPush` con `regalo {sellos, puntos}` que crea el admin (o una regla automatica)
**acreditan solos**, en una sola pasada: topes -> candado -> acreditar -> push. No existe ningun
estado "pendiente de aprobacion" en el codigo.

Controles que ya estan puestos y no se negocian:
- **Idempotencia**: `DisparoPushLog` con `UNIQUE(disparoId, clave)` y `UNIQUE(disparoId, clienteId, pedidoId)`.
- **Topes por cliente**: `limitePorCliente {porDia, porMes}`.
- **Auditoria**: `EventoAuditoria` con accion `push.disparo_regalo`.
- Solo dispara con el negocio y el disparo **activos**.

Verificado en produccion el 2026-10-09: un disparo COMPRA con regalo acredito +2 sellos/+15 puntos
en un pedido entregado (base + regalo), sin intervencion de nadie; y "Probar" **nunca** toca saldos.

## Pendientes post-MVP (NO implementados)

1. **Regalo manual a un cliente puntual** ("regalale +2 sellos ahora").
   Hoy un disparo `MANUAL` con regalo **nunca acredita**: MANUAL solo manda cuando se aprieta
   Enviar/Probar, y Probar no modifica saldos. Necesita diseno propio (a quien, cuanto, con que
   control de abuso y quien lo ve en el historial).

2. **`EnvioPushLog`: historial completo de envios.**
   `DisparoPushLog` alcanza para los disparos (enviado / omitido / saldo acreditado) y es lo que
   alimenta la pestana Historial del admin. Pero **no** cubre:
   - las campanas por segmento (`/push/enviar`, `/push/promocion`), que hoy solo dejan un agregado
     en `CampanaMarketing` sin fila por destinatario;
   - los push de estado de pedido ni los avisos al staff, que no dejan log.
   Propuesta: tabla `EnvioPushLog (negocioId, clienteId?, empleadoId?, plantillaId?, campanaId?,
   estado ENCOLADO/ENVIADO/FALLIDO, motivo, creadoEn)` escrita por `push.service`, y que el Historial
   la una con `DisparoPushLog`.
   Ademas: `DisparoPushLog` se borra en **cascada** al eliminar el disparo; si se quiere historial
   inmutable conviene `onDelete: SetNull` + snapshots del nombre del disparo/plantilla.

## Cuidado antes de una demo

Un disparo con `regalo` grande distorsiona todo: en `que-lomitos` el disparo `"uuu"` (COMPRA,
regalo +55 sellos / +555 puntos) hacia que **un solo pedido completara la tarjeta y pasara el
premio de puntos**. Se dejo **pausado** (`activa: false`, reversible) el 2026-10-09; los saldos ya
acreditados no se tocaron.

## Dos puertas de acreditacion (para tener presente)

1. `FidelizacionService.acreditar` — la via normal (visita aprobada y pedido ENTREGADO dan
   exactamente lo mismo: +1 sello en HIBRIDO y `floor(monto/1000 * puntosPorMil)` puntos).
2. `DisparosService.aplicarRegalo` — acredita el regalo de un disparo **directo**, sin pasar por la
   anterior. Si un saldo no cuadra, hay que mirar las dos.
