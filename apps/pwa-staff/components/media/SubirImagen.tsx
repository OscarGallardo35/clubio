'use client';

/**
 * Subida de la foto de un item de carta (PWA Staff).
 *
 * El componente REAL vive en `@repo/ui` (`SubirImagen`), compartido con el admin del dueno y el
 * panel de plataforma. Este archivo es una capa fina que:
 *  - inyecta la firma de ESTA app (`mediaApi.firmarSubida`, con la cookie `empleado_token`), y
 *  - traduce los errores con el normalizador del staff.
 *
 * Solo se dibuja para quien tiene el paquete completo de la carta: el backend responde 403 en
 * `POST /media/firmar-subida` a un empleado sin el permiso (el guard es la verdad; esto es
 * comodidad).
 */

import * as React from 'react';
import { SubirImagen as SubirImagenBase } from '@repo/ui';
import type { FirmaSubidaMedia } from '@repo/ui';
import { mediaApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';

export interface SubirImagenProps {
  /** URL actual (el `fotoUrl` del item). Vacio/null = sin foto. */
  valor: string | null | undefined;
  /** Se llama con el `secure_url` de Cloudinary (o '' al quitar la foto). */
  onCambio: (url: string) => void;
  etiqueta?: string | undefined;
}

export function SubirImagen({ valor, onCambio, etiqueta = 'Foto del item' }: SubirImagenProps) {
  // El endpoint solo firma subidas de tipo 'carta' (es su unico uso).
  const firmar = React.useCallback(
    (tipo: string): Promise<FirmaSubidaMedia> => mediaApi.firmarSubida({ tipo: tipo as 'carta' }),
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
