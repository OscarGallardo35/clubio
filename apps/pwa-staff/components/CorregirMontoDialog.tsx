'use client'

import * as React from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  toast,
} from '@repo/ui';
import { visitasApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';
import type { VisitaAprobada } from '@/types/api';

/**
 * Fase 2: corrige el monto de una visita ya aprobada (el caso "aprobe sin monto y se perdieron los
 * puntos").
 *
 * El backend recalcula los PUNTOS con la tasa vigente del club y ajusta el saldo del cliente. Si el
 * cliente ya gasto esos puntos responde 400 con el motivo: se muestra tal cual, porque es
 * accionable (hablar con el cliente o dejarlo asi) y no un error de red que se reintenta.
 */
export function CorregirMontoDialog({
  visita,
  abierto,
  onCerrar,
  onCorregido,
}: {
  visita: VisitaAprobada | null;
  abierto: boolean;
  onCerrar: () => void;
  onCorregido?: () => void;
}) {
  const [monto, setMonto] = React.useState('');
  const [guardando, setGuardando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Al abrir, el input arranca con el monto actual (o vacio si la visita se aprobo sin monto).
  React.useEffect(() => {
    if (!abierto) return;
    setMonto(visita?.montoConsumido === null || visita?.montoConsumido === undefined ? '' : String(visita.montoConsumido));
    setError(null);
  }, [abierto, visita?.id, visita?.montoConsumido]);

  const numero = monto.trim() === '' ? null : Number(monto.replace(',', '.'));
  const valido = numero !== null && Number.isFinite(numero) && numero >= 0;

  async function guardar() {
    if (!visita || !valido || numero === null) return;
    setGuardando(true);
    setError(null);
    try {
      const r = await visitasApi.editarMonto(visita.id, numero);
      toast.success('Monto corregido · Saldo actualizado', {
        description: `Puntos: ${r.puntosAntes} → ${r.puntosDespues} · Saldo del cliente: ${r.saldoDespues}`,
      });
      onCorregido?.();
      onCerrar();
    } catch (e) {
      const { status, mensaje } = normalizarError(e);
      // 400 trae el motivo del backend ("El cliente ya gasto esos puntos: ...") y es lo accionable.
      setError(status === 400 ? mensaje : `No se pudo corregir. ${mensaje}`);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => {
        if (!v && !guardando) onCerrar();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Corregir el monto del consumo</DialogTitle>
          <DialogDescription>
            {visita?.cliente?.nombre ?? 'El cliente'}: se recalculan los puntos con la tasa del club
            y se ajusta su saldo. La visita tiene que ser de hoy.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="monto-corregir">Consumo ($)</Label>
          <Input
            id="monto-corregir"
            value={monto}
            onChange={(e) => setMonto(e.target.value.replace(/[^0-9.,]/g, '').slice(0, 12))}
            inputMode="decimal"
            placeholder="Ej: 6800"
            autoFocus
          />
          {numero !== null && !valido ? (
            <p role="alert" className="text-xs text-destructive">
              El monto tiene que ser un numero.
            </p>
          ) : null}
          {visita ? (
            <p className="text-xs text-muted-foreground">
              Ahora: {visita.montoConsumido === null ? 'sin monto' : `$${visita.montoConsumido.toLocaleString('es-AR')}`} ·{' '}
              {visita.puntosOtorgados} puntos otorgados
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" className="min-h-12" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button
            className="min-h-12 bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={() => void guardar()}
            disabled={!valido || guardando}
          >
            {guardando ? 'Guardando...' : 'Guardar monto'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
