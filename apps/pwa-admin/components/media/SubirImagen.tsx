'use client';

/**
 * Subida de la foto de un item de carta (admin del dueno).
 *
 * El componente REAL vive en `@repo/ui` (`SubirImagen`), porque lo comparten el admin del
 * dueno y el panel de plataforma. Este archivo es una capa fina que:
 *  - inyecta la firma de ESTA app (`mediaApi.firmarSubida`, con la cookie de dueno), y
 *  - traduce los errores con el normalizador del admin.
 *
 * Se mantiene la MISMA ruta de import y la MISMA firma de props (`valor`/`onCambio`/`etiqueta`)
 * para que ningun consumidor del admin tenga que cambiar.
 */

import * as React from 'react';
import { SubirImagen as SubirImagenBase } from '@repo/ui';
import { mediaApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';

export type { EstadoSubida } from '@repo/ui';

export interface SubirImagenProps {
  /** URL actual (el `fotoUrl` del item). Vacio/null = sin foto. */
  valor: string | null | undefined;
  /** Se llama con el `secure_url` de Cloudinary (o '' al quitar la foto). */
  onCambio: (url: string) => void;
  etiqueta?: string | undefined;
}

export function SubirImagen({ valor, onCambio, etiqueta = 'Foto del item' }: SubirImagenProps) {
  // El endpoint del admin solo firma subidas de tipo 'carta' (es su unico uso); el componente
  // compartido acepta cualquier tipo, pero aca no hay otro valido.
  const firmar = React.useCallback(
    (tipo: string) => mediaApi.firmarSubida({ tipo: tipo as 'carta' }),
    [],
  );
  const mensajeDeError = React.useCallback((e: unknown) => normalizarError(e).mensaje, []);
  return (
    <SubirImagenBase
      valor={valor}
      onCambio={onCambio}
      etiqueta={etiqueta}
      firmar={firmar}
      mensajeDeError={mensajeDeError}
    />
  );
}
