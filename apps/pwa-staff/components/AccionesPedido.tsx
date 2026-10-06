'use client'

import * as React from 'react';
import { Button, toast } from '@repo/ui';
import { SheetAccion } from '@/components/SheetAccion';
import { pedidosApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';
import { ETIQUETA_ACCION, requiereMotivo, transicionesValidas } from '@/lib/pedidos-maquina';
import type { EstadoPedido, PedidoStaff } from '@/types/api';

/**
 * Los botones de transicion de un pedido, con sus confirmaciones.
 *
 * Vive en un solo lugar porque lo usan la LISTA y el DETALLE: si la maquina de
 * estados cambia, no hay dos lugares que actualizar.
 *
 * Rechazar y Cancelar abren un BottomSheet (Dialog/AlertDialog son stubs). Rechazar
 * exige motivo >= 10 porque el backend lo exige.
 */
export function AccionesPedido({
  pedido,
  puedeTomar,
  empleadoId,
  ocupado,
  onCambio,
}: {
  pedido: PedidoStaff;
  puedeTomar: boolean;
  empleadoId: string | null;
  /** Lo controla el que lo usa cuando maneja el estado de carga (el detalle). */
  ocupado?: boolean;
  onCambio: () => void | Promise<void>;
}) {
  const [enviando, setEnviando] = React.useState<string | null>(null);
  const [sheet, setSheet] = React.useState<EstadoPedido | null>(null);

  const acciones = transicionesValidas(pedido.estado, pedido.tipo);
  const asignadoAMi = Boolean(empleadoId) && pedido.empleadoAsignadoId === empleadoId;
  const bloqueado = Boolean(ocupado) || enviando !== null;

  async function cambiar(hacia: EstadoPedido, motivo?: string) {
    setEnviando(hacia);
    try {
      await pedidosApi.cambiarEstado(pedido.id, { estado: hacia, ...(motivo ? { motivo } : {}) });
      toast.success(`Pedido: ${ETIQUETA_ACCION[hacia] ?? hacia}`);
      setSheet(null);
      await onCambio();
    } catch (e) {
      const { status, mensaje } = normalizarError(e);
      // 400 = transicion invalida (el espejo del UI y el backend se desincronizaron)
      // o motivo corto. El mensaje del backend es el que sabe.
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
      await onCambio();
    } catch (e) {
      const { status, mensaje } = normalizarError(e);
      // 409 = otro empleado lo tomo primero (carrera real entre dos telefonos).
      toast.error(status === 409 ? mensaje : `No se pudo tomar. ${mensaje}`);
      await onCambio();
    } finally {
      setEnviando(null);
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {acciones.map((hacia) => {
          const esFinal = hacia === 'RECHAZADO' || hacia === 'CANCELADO';
          return (
            <Button
              key={hacia}
              variant={esFinal ? 'destructive' : 'default'}
              className={`min-h-12 flex-1 ${hacia === 'LISTO' ? 'bg-emerald-600 text-white hover:bg-emerald-700' : ''}`}
              disabled={bloqueado}
              onClick={() => (requiereMotivo(hacia) || esFinal ? setSheet(hacia) : void cambiar(hacia))}
            >
              {enviando === hacia ? '...' : (ETIQUETA_ACCION[hacia] ?? hacia)}
            </Button>
          );
        })}

        {puedeTomar && !pedido.empleadoAsignadoId && !asignadoAMi ? (
          <Button variant="outline" className="min-h-12 flex-1" disabled={bloqueado} onClick={() => void tomar()}>
            {enviando === 'TOMAR' ? '...' : 'Tomar'}
          </Button>
        ) : null}
      </div>

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
          ? { requiereMotivo: true, etiquetaMotivo: 'Motivo del rechazo', placeholder: 'Ej: se acabo el stock de ese plato' }
          : {})}
        textoConfirmar={sheet === 'RECHAZADO' ? 'Rechazar' : 'Cancelar pedido'}
        destructivo
        ocupado={enviando !== null}
        onConfirmar={(motivo) => sheet && void cambiar(sheet, motivo || undefined)}
      />
    </>
  );
}
