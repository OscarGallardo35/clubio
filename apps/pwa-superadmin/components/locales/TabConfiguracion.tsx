'use client';

import * as React from 'react';
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  toast,
} from '@repo/ui';
import { superadminApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';
import { MODOS_FIDELIZACION } from '@/types/api';
import type { ConfiguracionLocal, LocalDetalle, ModoFidelizacion } from '@/types/api';

const ETIQUETA_MODO: Record<ModoFidelizacion, string> = {
  SOLO_VISITAS: 'Solo visitas (sellos)',
  SOLO_PUNTOS: 'Solo puntos',
  HIBRIDO: 'Hibrido (visitas + puntos)',
};

/**
 * Configuracion del club del local.
 *
 * Es el mismo formulario que la pestana "Local" del admin del dueno (mismo backend,
 * `PATCH /configuracion`), reducido a los cuatro campos que deciden si la demo funciona:
 * como se gana el premio, cuantos sellos hacen falta, que gana y a que WhatsApp escribe
 * el cliente.
 *
 * Se mandan SOLO estos campos. El `ValidationPipe` del backend corre con
 * `forbidNonWhitelisted`: un campo de mas devuelve 400 y el guardado falla entero (mismo
 * cuidado que documenta el admin del dueno).
 *
 * El estado del formulario vive en el componente INTERNO y se remonta con `key` cuando
 * cambia el detalle: es la misma tecnica que usa el admin para no sincronizar el form a
 * mano. Sin el `key`, el form se monta con el detalle todavia en null y se queda con los
 * defaults aunque despues lleguen los valores reales.
 */
export function TabConfiguracion({
  negocioId,
  detalle,
  onGuardado,
}: {
  negocioId: string;
  detalle: LocalDetalle | null;
  onGuardado: () => void | Promise<void>;
}) {
  if (detalle === null) return <Skeleton className="h-72 w-full" />;

  const cfg = detalle.configuracion ?? null;
  const clave = [
    negocioId,
    cfg?.modoFidelizacion ?? 'x',
    cfg?.sellosParaPremio ?? 'x',
    cfg?.premioTexto ?? 'x',
    cfg?.numeroAtendiente ?? 'x',
  ].join('|');

  return (
    <FormConfiguracion
      key={clave}
      negocioId={negocioId}
      cfg={cfg}
      numeroAtendiente={detalle.numeroAtendiente ?? ''}
      onGuardado={onGuardado}
    />
  );
}

function FormConfiguracion({
  negocioId,
  cfg,
  numeroAtendiente,
  onGuardado,
}: {
  negocioId: string;
  cfg: ConfiguracionLocal | null;
  numeroAtendiente: string;
  onGuardado: () => void | Promise<void>;
}) {
  const [modo, setModo] = React.useState<ModoFidelizacion>(cfg?.modoFidelizacion ?? 'SOLO_VISITAS');
  const [sellos, setSellos] = React.useState(String(cfg?.sellosParaPremio ?? 6));
  const [premio, setPremio] = React.useState(cfg?.premioTexto ?? '');
  const [whatsapp, setWhatsapp] = React.useState(cfg?.numeroAtendiente ?? numeroAtendiente);
  const [guardando, setGuardando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [guardado, setGuardado] = React.useState(false);

  const sellosNum = Number(sellos.replace(',', '.'));
  const sellosValido =
    sellos.trim() !== '' && Number.isFinite(sellosNum) && sellosNum >= 1 && sellosNum <= 100;
  const valido = premio.trim().length >= 2 && sellosValido && !guardando;

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!valido) return;
    setGuardando(true);
    setError(null);
    setGuardado(false);
    try {
      const wa = whatsapp.trim();
      await superadminApi.actualizarConfiguracion(negocioId, {
        modoFidelizacion: modo,
        sellosParaPremio: sellosNum,
        premioTexto: premio.trim(),
        // Vaciar el WhatsApp manda `null` EXPLICITO: el backend lo BORRA. El vacio ('') seguiria
        // significando "no tocar", que es justo lo que impedia limpiar el numero.
        numeroAtendiente: wa === '' ? null : wa,
      });
      toast.success('Configuracion guardada');
      setGuardado(true);
      await onGuardado();
    } catch (e) {
      setError(normalizarError(e).mensaje);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-5 rounded-2xl border bg-card p-5">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">Configuracion del club</h2>
        <p className="text-sm text-muted-foreground">
          Como se gana el premio y donde escribe el cliente. Es la config del club, no la de
          pedidos ni pagos (eso lo maneja el dueno).
        </p>
      </header>

      {cfg === null ? (
        <p
          role="status"
          className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          Este local todavia no tiene configuracion de club cargada. Al guardar se crea. Podes
          adelantarla provisionando una plantilla.
        </p>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="cfg-modo">Como se gana el premio</Label>
        <Select value={modo} onValueChange={(v) => setModo(v as ModoFidelizacion)}>
          <SelectTrigger id="cfg-modo" className="sm:max-w-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODOS_FIDELIZACION.map((m) => (
              <SelectItem key={m} value={m}>
                {ETIQUETA_MODO[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="cfg-sellos">Sellos para el premio</Label>
          <Input
            id="cfg-sellos"
            value={sellos}
            onChange={(e) => setSellos(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
            inputMode="numeric"
          />
          <p className="text-xs text-muted-foreground">
            Cuantas visitas necesita el cliente para el premio.
          </p>
          {!sellosValido && sellos !== '' ? (
            <p role="alert" className="text-xs text-destructive">
              Tiene que ser un numero entre 1 y 100.
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="cfg-wa">WhatsApp del local</Label>
          <Input
            id="cfg-wa"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value.slice(0, 40))}
            inputMode="tel"
            placeholder="+54911..."
          />
          <p className="text-xs text-muted-foreground">
            Donde el cliente escribe para canjear el premio. Borralo y guarda para <strong>limpiar</strong>{' '}
            el numero.
          </p>
          {whatsapp.trim() === '' ? (
            <p role="status" data-testid="wa-vacio" className="text-xs text-muted-foreground">
              Sin WhatsApp cargado.
            </p>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="cfg-premio">Que gana el cliente</Label>
        <Input
          id="cfg-premio"
          value={premio}
          onChange={(e) => setPremio(e.target.value.slice(0, 160))}
          placeholder="Una pizza gratis"
        />
        <p className="text-xs text-muted-foreground">
          Es lo que ve en su tarjeta. Maximo 160 caracteres.
        </p>
      </div>

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {guardado && !error ? (
        <p role="status" className="text-sm text-emerald-700">
          Guardado.
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={!valido}>
          {guardando ? 'Guardando...' : 'Guardar configuracion'}
        </Button>
      </div>
    </form>
  );
}
