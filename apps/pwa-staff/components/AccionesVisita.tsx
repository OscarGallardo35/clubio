'use client'

import * as React from 'react';
import { BottomSheet, Button, Label, Textarea, toast } from '@repo/ui';
import { visitasApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';

/**
 * Aprobar / rechazar una visita. Lo usan la lista (/visitas) y el link del
 * WhatsApp (/validar), asi que la logica de las dos acciones vive en un lugar.
 *
 * El motivo se pide en un <BottomSheet> y NO en un <Dialog>: en @repo/ui `Dialog`
 * y `AlertDialog` siguen siendo stubs (`crearStub`, renderizan null) mientras que
 * BottomSheet es una implementacion real y mobile-first. Un Dialog aca habria
 * abierto... nada, en silencio.
 *
 * El motivo es OBLIGATORIO en la UI aunque el DTO lo acepte vacio: el cliente ve
 * ese texto, y un "Rechazada por el local" generico no le sirve a nadie.
 */
export function AccionesVisita({
  token,
  onAprobada,
  onRechazada,
  deshabilitado,
}: {
  token: string;
  onAprobada?: (r: { premioDesbloqueado: boolean; sellosActuales: number }) => void;
  onRechazada?: () => void;
  deshabilitado?: boolean;
}) {
  const [aprobando, setAprobando] = React.useState(false);
  const [rechazando, setRechazando] = React.useState(false);
  const [sheetAbierto, setSheet] = React.useState(false);
  const [motivo, setMotivo] = React.useState('');

  const ocupado = aprobando || rechazando || Boolean(deshabilitado);
  const motivoValido = motivo.trim().length >= 3;

  async function aprobar() {
    setAprobando(true);
    try {
      const r = await visitasApi.aprobar(token);
      toast.success(
        r.premioDesbloqueado ? 'Visita aprobada. El cliente desbloqueo su premio' : 'Visita aprobada',
        { description: `Sellos: ${r.sellosActuales}` },
      );
      onAprobada?.({ premioDesbloqueado: r.premioDesbloqueado, sellosActuales: r.sellosActuales });
    } catch (e) {
      const { status, mensaje } = normalizarError(e);
      // 400 = token ya usado, 410 = vencido: son estados del token, no fallos de red.
      toast.error(status === 400 || status === 410 ? mensaje : `No se pudo aprobar. ${mensaje}`);
    } finally {
      setAprobando(false);
    }
  }

  async function rechazar() {
    if (!motivoValido) return;
    setRechazando(true);
    try {
      await visitasApi.rechazar(token, { motivo: motivo.trim() });
      toast.success('Visita rechazada');
      setSheet(false);
      setMotivo('');
      onRechazada?.();
    } catch (e) {
      const { status, mensaje } = normalizarError(e);
      toast.error(status === 400 ? mensaje : `No se pudo rechazar. ${mensaje}`);
    } finally {
      setRechazando(false);
    }
  }

  return (
    <>
      <div className="flex gap-2">
        <Button
          className="min-h-12 flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
          onClick={() => void aprobar()}
          disabled={ocupado}
        >
          {aprobando ? 'Aprobando...' : 'Aprobar'}
        </Button>

        <Button
          variant="destructive"
          className="min-h-12 flex-1"
          onClick={() => setSheet(true)}
          disabled={ocupado}
        >
          Rechazar
        </Button>
      </div>

      <BottomSheet
        abierto={sheetAbierto}
        onCerrar={() => (rechazando ? undefined : setSheet(false))}
        titulo="Rechazar la visita"
      >
        <div className="space-y-3 pb-2">
          <p className="text-sm text-muted-foreground">
            El cliente va a ver este motivo. Se breve y concreto.
          </p>
          <div className="space-y-2">
            <Label htmlFor="motivo">Motivo</Label>
            <Textarea
              id="motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value.slice(0, 300))}
              placeholder="Ej: el telefono ya sumo una visita hoy"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{motivo.length}/300</span>
              {motivo.length > 0 && !motivoValido ? (
                <span role="alert" className="text-xs text-destructive">
                  Escribi al menos 3 caracteres
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="min-h-12 flex-1" onClick={() => setSheet(false)} disabled={rechazando}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              className="min-h-12 flex-1"
              onClick={() => void rechazar()}
              disabled={!motivoValido || rechazando}
            >
              {rechazando ? 'Rechazando...' : 'Rechazar'}
            </Button>
          </div>
        </div>
      </BottomSheet>
    </>
  );
}
