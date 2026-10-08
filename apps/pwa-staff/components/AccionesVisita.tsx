'use client'

import * as React from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  BottomSheet,
  Button,
  Input,
  Label,
  Textarea,
  toast,
} from '@repo/ui';
import { visitasApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';
import type { ConfiguracionEfectivaStaff, TipoCanje, VisitaValidable } from '@/types/api';

/** Mismos defaults que el backend (`FidelizacionService`): si no, el preview mentiria. */
const PUNTOS_POR_MIL_DEFAULT = 5;
const PUNTOS_PARA_PREMIO_DEFAULT = 100;

/**
 * Aprobar / rechazar una visita, y canjear un premio ya desbloqueado.
 *
 * Lo usan la lista (/visitas) y el link del WhatsApp (/validar), asi que la logica de las tres
 * acciones vive en un lugar.
 *
 * LO QUE AGREGO EL MODO HIBRIDO:
 * - El monto del consumo (opcional). Solo aparece si el club da puntos: con SOLO_VISITAS un campo
 *   de monto no cambia nada y confunde.
 * - El preview de lo que se va a otorgar, recalculado con la tasa del club ("+1 sello +34 puntos").
 * - El badge de premio desbloqueado y el canje, con confirmacion (resta saldo y no se deshace).
 *
 * El motivo del rechazo va en un `<BottomSheet>` y no en un `<Dialog>`: el staff trabaja parado,
 * con el celular, y ese es el patron que ya usa la pantalla. Para la CONFIRMACION del canje si va
 * un `<AlertDialog>`: la idea es justamente que no se cierre sin querer.
 */
export function AccionesVisita({
  token,
  config,
  onAprobada,
  onRechazada,
  deshabilitado,
}: {
  token: string;
  /** Config efectiva del club: el padre la pide una vez y la baja a todas las filas. */
  config?: ConfiguracionEfectivaStaff | null;
  onAprobada?: (r: { premioDesbloqueado: boolean; sellosActuales: number }) => void;
  onRechazada?: () => void;
  deshabilitado?: boolean;
}) {
  const [aprobando, setAprobando] = React.useState(false);
  const [rechazando, setRechazando] = React.useState(false);
  const [sheetAbierto, setSheet] = React.useState(false);
  const [motivo, setMotivo] = React.useState('');
  const [monto, setMonto] = React.useState('');
  const [detalle, setDetalle] = React.useState<VisitaValidable | null>(null);
  const [canjeando, setCanjeando] = React.useState(false);
  const [aCanjear, setACanjear] = React.useState<TipoCanje | null>(null);

  const ocupado = aprobando || rechazando || canjeando || Boolean(deshabilitado);
  const motivoValido = motivo.trim().length >= 3;

  // El modo manda: si el club no da puntos, el monto no se pide.
  const modo = config?.modoFidelizacion ?? 'SOLO_VISITAS';
  const usaPuntos = modo !== 'SOLO_VISITAS';
  const puntosPorMil = config?.puntosPorMil ?? PUNTOS_POR_MIL_DEFAULT;
  const premioPorPuntos = config?.premioPorPuntos ?? PUNTOS_PARA_PREMIO_DEFAULT;
  const sellosParaPremio = config?.sellosParaPremio ?? 10;

  // Saldos frescos: `pendientes` no los trae, `validar/:token` si (y ademas dice si el token sigue
  // siendo util).
  React.useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const v = await visitasApi.validar(token);
        if (vivo && v.estado === 'VALIDO') setDetalle(v);
      } catch {
        // Token aprobado o vencido en otro dispositivo: el proximo refetch del padre saca la fila.
      }
    })();
    return () => {
      vivo = false;
    };
  }, [token]);

  const montoNumero = monto.trim() === '' ? null : Number(monto.replace(',', '.'));
  const montoValido = montoNumero === null || (Number.isFinite(montoNumero) && montoNumero >= 0);
  const sellosPreview = modo === 'SOLO_PUNTOS' ? 0 : 1;
  const puntosPreview =
    montoNumero === null || !Number.isFinite(montoNumero)
      ? 0
      : Math.floor((montoNumero / 1000) * (Number.isFinite(puntosPorMil) ? puntosPorMil : 0));

  const partes = [
    sellosPreview ? '+1 sello' : null,
    puntosPreview ? `+${puntosPreview} puntos` : null,
  ].filter(Boolean);
  const preview = partes.length > 0 ? partes.join(' ') : 'nada (sin monto no hay puntos)';

  const sellosActuales = detalle?.cliente.sellosActuales ?? 0;
  const puntosActuales = detalle?.cliente.puntosActuales ?? 0;
  const sellosListos = sellosActuales >= sellosParaPremio;
  const puntosListos = usaPuntos && puntosActuales >= premioPorPuntos;

  async function aprobar() {
    if (!montoValido) return;
    setAprobando(true);
    try {
      const r = await visitasApi.aprobar(
        token,
        montoNumero !== null ? { montoConsumido: montoNumero } : {},
      );
      const otorgado = [
        r.sellosOtorgados ? `+${r.sellosOtorgados} sello` : null,
        r.puntosOtorgados ? `+${r.puntosOtorgados} puntos` : null,
      ]
        .filter(Boolean)
        .join(' ');
      const listo = r.premioDesbloqueado || r.premioPuntosDesbloqueado;
      toast.success(`Visita aprobada${otorgado ? ` · ${otorgado}` : ''}`, {
        description: listo ? 'El cliente desbloqueo su premio' : undefined,
      });
      onAprobada?.({ premioDesbloqueado: listo, sellosActuales: r.sellosActuales });
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

  async function canjear(tipo: TipoCanje) {
    if (!detalle) return;
    setCanjeando(true);
    try {
      const r = await visitasApi.canjear(detalle.cliente.id, tipo);
      const saldo = tipo === 'PUNTOS' ? `${r.puntosActuales} puntos` : `${r.sellosActuales} sellos`;
      toast.success(`Premio canjeado · Saldo restante: ${saldo}`, { description: r.premioTexto });
      setACanjear(null);
      setDetalle({
        ...detalle,
        cliente: { ...detalle.cliente, sellosActuales: r.sellosActuales, puntosActuales: r.puntosActuales },
      });
    } catch (e) {
      const { status, mensaje } = normalizarError(e);
      toast.error(status === 400 ? mensaje : `No se pudo canjear. ${mensaje}`);
    } finally {
      setCanjeando(false);
    }
  }

  return (
    <>
      {sellosListos || puntosListos ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2">
          <Badge className="bg-emerald-600 text-white">Premio desbloqueado</Badge>
          {sellosListos ? (
            <Button
              size="sm"
              variant="outline"
              className="min-h-10"
              disabled={ocupado}
              onClick={() => setACanjear('SELLOS')}
            >
              Canjear {config?.premioTexto || 'premio'}
            </Button>
          ) : null}
          {puntosListos ? (
            <Button
              size="sm"
              variant="outline"
              className="min-h-10"
              disabled={ocupado}
              onClick={() => setACanjear('PUNTOS')}
            >
              Canjear {config?.premioTextoPuntos || 'premio por puntos'}
            </Button>
          ) : null}
        </div>
      ) : null}

      {usaPuntos ? (
        <div className="space-y-2">
          <Label htmlFor={`monto-${token}`}>Consumo (opcional)</Label>
          <Input
            id={`monto-${token}`}
            value={monto}
            onChange={(e) => setMonto(e.target.value.replace(/[^0-9.,]/g, '').slice(0, 12))}
            inputMode="decimal"
            placeholder="Ej: 6800"
          />
          <p className="text-xs text-muted-foreground" role="status">
            Vas a otorgar: <strong>{preview}</strong>
          </p>
          {!montoValido ? (
            <p role="alert" className="text-xs text-destructive">
              El monto tiene que ser un numero.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex gap-2">
        <Button
          className="min-h-12 flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
          onClick={() => void aprobar()}
          disabled={ocupado || !montoValido}
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

      <AlertDialog
        open={aCanjear !== null}
        onOpenChange={(abierto) => {
          if (!abierto) setACanjear(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Canjear{' '}
              {aCanjear === 'PUNTOS'
                ? config?.premioTextoPuntos || 'el premio por puntos'
                : config?.premioTexto || 'el premio'}
              ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se le restan {aCanjear === 'PUNTOS' ? `${premioPorPuntos} puntos` : `${sellosParaPremio} sellos`} al
              cliente. No se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={canjeando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => aCanjear && void canjear(aCanjear)}
              disabled={canjeando}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {canjeando ? 'Canjeando...' : 'Canjear'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
