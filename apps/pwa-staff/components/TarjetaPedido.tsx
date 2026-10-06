'use client'

import * as React from 'react';
import { Badge, Button, Card, CardContent, toast } from '@repo/ui';
import { SheetAccion } from '@/components/SheetAccion';
import { pedidosApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';
import {
  COLOR_ESTADO,
  ETIQUETA_ACCION,
  ETIQUETA_ESTADO,
  ETIQUETA_TIPO,
  horaCorta,
  requiereMotivo,
  transicionesValidas,
} from '@/lib/pedidos-maquina';
import type { EstadoPedido, PedidoStaff } from '@/types/api';

/**
 * Una fila de la lista de pedidos, con las acciones que la maquina de estados
 * permite para ESE estado y tipo.
 */
export function TarjetaPedido({
  pedido,
  puedeTomar,
  empleadoId,
  onCambio,
}: {
  pedido: PedidoStaff;
  /** false si el modo de asignacion no es BROADCAST (el backend da 400). */
  puedeTomar: boolean;
  empleadoId: string | null;
  onCambio: () => void;
}) {
  const [enviando, setEnviando] = React.useState<string | null>(null);
  const [sheet, setSheet] = React.useState<EstadoPedido | null>(null);

  const acciones = transicionesValidas(pedido.estado, pedido.tipo);
  const asignadoAMi = Boolean(empleadoId) && pedido.empleadoAsignadoId === empleadoId;
  const tomadoPorOtro = Boolean(pedido.empleadoAsignadoId) && !asignadoAMi;

  async function cambiar(hacia: EstadoPedido, motivo?: string) {
    setEnviando(hacia);
    try {
      await pedidosApi.cambiarEstado(pedido.id, { estado: hacia, ...(motivo ? { motivo } : {}) });
      toast.success(`${ETIQUETA_ACCION[hacia] ?? hacia}: pedido actualizado`);
      setSheet(null);
      onCambio();
    } catch (e) {
      const { status, mensaje } = normalizarError(e);
      // 400 = transicion invalida (el espejo del UI y el backend se desincronizaron)
      // o motivo corto. Se muestra el mensaje del backend tal cual, que es el que sabe.
      toast.error(status >= 500 ? 'No se pudo actualizar el pedido' : mensaje);
    } finally {
      setEnviando(null);
    }
  }

  async function tomar() {
    setEnviando('TOMAR');
    try {
      const r = await pedidosApi.tomar(pedido.id);
      toast.success(r.yaAsignado ? 'Ya tenias este pedido' : 'Tomaste el pedido');
      onCambio();
    } catch (e) {
      const { status, mensaje } = normalizarError(e);
      // 409 = otro empleado lo tomo primero (carrera real entre dos telefonos).
      toast.error(status === 409 ? mensaje : `No se pudo tomar. ${mensaje}`);
      onCambio();
    } finally {
      setEnviando(null);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-medium">
              <span>#{pedido.numeroAtendiente ?? '--'}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {ETIQUETA_TIPO[pedido.tipo]}
              </span>
            </p>
            <p className="truncate text-sm text-muted-foreground">
              {pedido.nombreCliente}
              {pedido.mesa ? ` · mesa ${pedido.mesa}` : ''}
            </p>
            <p className="text-xs text-muted-foreground">
              {horaCorta(pedido.creadoEn)} · {pedido.sucursal?.nombre ?? ''}
            </p>
          </div>
          <Badge variant="outline" className={COLOR_ESTADO[pedido.estado]}>
            {ETIQUETA_ESTADO[pedido.estado]}
          </Badge>
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {Array.isArray(pedido.items) ? `${pedido.items.length} item(s)` : ''}
          </span>
          <span className="font-semibold">${pedido.total.toFixed(2)}</span>
        </div>

        {tomadoPorOtro ? (
          <p className="text-xs text-muted-foreground">
            Tomado por {pedido.empleadoAsignado?.nombre ?? 'otro empleado'}
          </p>
        ) : null}

        {/* Acciones de la maquina de estados */}
        <div className="flex flex-wrap gap-2">
          {acciones.map((hacia) => {
            const esFinal = hacia === 'RECHAZADO' || hacia === 'CANCELADO';
            const texto = ETIQUETA_ACCION[hacia] ?? hacia;
            return (
              <Button
                key={hacia}
                variant={esFinal ? 'destructive' : 'default'}
                className={`min-h-12 flex-1 ${hacia === 'LISTO' ? 'bg-emerald-600 text-white hover:bg-emerald-700' : ''}`}
                disabled={enviando !== null}
                onClick={() => (requiereMotivo(hacia) || esFinal ? setSheet(hacia) : void cambiar(hacia))}
              >
                {enviando === hacia ? '...' : texto}
              </Button>
            );
          })}

          {/* Tomar: solo si nadie lo tomo, el modo es BROADCAST y sigue activo */}
          {puedeTomar && !pedido.empleadoAsignadoId && !asignadoAMi ? (
            <Button
              variant="outline"
              className="min-h-12 flex-1"
              disabled={enviando !== null}
              onClick={() => void tomar()}
            >
              {enviando === 'TOMAR' ? '...' : 'Tomar'}
            </Button>
          ) : null}
        </div>
      </CardContent>

      <SheetAccion
        abierto={sheet !== null}
        onCerrar={() => setSheet(null)}
        titulo={sheet === 'RECHAZADO' ? 'Rechazar el pedido' : 'Cancelar el pedido'}
        descripcion={
          sheet === 'RECHAZADO'
            ? 'El cliente va a ver este motivo. El backend exige al menos 10 caracteres.'
            : 'El cliente va a ver que el pedido se cancelo. No lleva motivo.'
        }
        {...(sheet === 'RECHAZADO'
          ? {
              requiereMotivo: true,
              etiquetaMotivo: 'Motivo del rechazo',
              placeholder: 'Ej: se acabo el stock de ese plato',
            }
          : {})}
        textoConfirmar={sheet === 'RECHAZADO' ? 'Rechazar' : 'Cancelar pedido'}
        destructivo
        ocupado={enviando !== null}
        onConfirmar={(motivo) => sheet && void cambiar(sheet, motivo || undefined)}
      />
    </Card>
  );
}
