'use client';

import * as React from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { Button, Skeleton, toast } from '@repo/ui';
import { negociosApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';
import type { QrInfo } from '@/types/api';

/**
 * Los 2 QRs del local.
 *
 * Son FIJOS (no hay un QR por mesa): lo dice el backend en `qrInfo`. El de MENU va en las mesas,
 * el de CLUB es el que el cliente escanea para sumar la visita (y de paso la resena).
 *
 * El PNG sale del `<canvas>` que renderiza `qrcode.react`: se descarga con un `<a download>` al que
 * le pasamos el dataURL. No hay endpoint de "descargar QR" (y no hace falta).
 */
export default function QrPage() {
  const [info, setInfo] = React.useState<QrInfo | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [descargando, setDescargando] = React.useState<string | null>(null);

  const refMenu = React.useRef<HTMLDivElement>(null);
  const refClub = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const r = await negociosApi.qrInfo();
        if (vivo) setInfo(r);
      } catch (e) {
        const { status, mensaje } = normalizarError(e);
        if (vivo && status !== 401) setError(mensaje);
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  React.useEffect(() => {
    if (error) toast.error('No pudimos traer los QR', { description: error });
  }, [error]);

  const descargar = React.useCallback((ref: React.RefObject<HTMLDivElement>, archivo: string) => {
    // El canvas lo dibuja qrcode.react adentro del div; no hay que renderizar nada a mano.
    const canvas = ref.current?.querySelector('canvas');
    if (!canvas) {
      toast.error('Todavia no termino de dibujarse el QR');
      return;
    }
    setDescargando(archivo);
    try {
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `${archivo}.png`;
      a.click();
    } finally {
      setDescargando(null);
    }
  }, []);

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">QR del local</h1>
        <p className="text-sm text-muted-foreground">
          Dos codigos, dos usos. Podes descargarlos en PNG para imprimir o mandarlos por WhatsApp.
        </p>
      </header>

      {info === null && !error ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : null}

      {info ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <BloqueQr
            titulo={info.qrMenu.etiqueta}
            url={info.qrMenu.url}
            instruccion="Imprimilo y pegalo en las mesas: el cliente ve la carta y pide desde el celular."
            refQr={refMenu}
            onDescargar={() => descargar(refMenu, 'qr-menu')}
            descargando={descargando === 'qr-menu'}
          />
          <BloqueQr
            titulo={info.qrClub.etiqueta}
            url={info.qrClub.url}
            instruccion="Mostralo (o imprimilo en el mostrador) para que el cliente sume su visita y vea su tarjeta."
            refQr={refClub}
            onDescargar={() => descargar(refClub, 'qr-club')}
            descargando={descargando === 'qr-club'}
          />
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Los dos apuntan a <code className="rounded bg-muted px-1">app.clubio.lat</code>. Si mas
        adelante cambia el dominio, el backend los sigue generando solos: no hay que reimprimir por un
        cambio de URL.
      </p>
    </section>
  );
}

function BloqueQr({
  titulo,
  url,
  instruccion,
  refQr,
  onDescargar,
  descargando,
}: {
  titulo: string;
  url: string;
  instruccion: string;
  refQr: React.RefObject<HTMLDivElement>;
  onDescargar: () => void;
  descargando: boolean;
}) {
  return (
    <div className="rounded-2xl border bg-card p-5">
      <h2 className="text-lg font-semibold">{titulo}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{instruccion}</p>

      <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        {/* El fondo blanco es a proposito: el QR necesita contraste, no el tema oscuro. */}
        <div ref={refQr} className="rounded-xl bg-white p-3">
          <QRCodeCanvas value={url} size={176} level="M" marginSize={0} />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <p className="break-all text-xs text-muted-foreground">{url}</p>
          <Button onClick={onDescargar} disabled={descargando}>
            {descargando ? 'Generando...' : 'Descargar PNG'}
          </Button>
        </div>
      </div>
    </div>
  );
}
