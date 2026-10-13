'use client';

import * as React from 'react';
import { Button } from '@repo/ui';

/**
 * Boton "Copiar" con confirmacion visual.
 *
 * Es lo unico que el operador se lleva de la pantalla de resultado (los links del demo), asi
 * que el feedback importa: sin el, no sabe si copio o no y termina pegando dos veces.
 *
 * `clipboard.writeText` puede faltar (contexto no seguro) o ser rechazado (permiso): el
 * `.then(ok, err)` cubre los dos y deja el boton en "No se pudo" en vez de mentir.
 */
export function BotonCopiar({
  valor,
  etiqueta = 'Copiar',
  className,
}: {
  valor: string;
  etiqueta?: string | undefined;
  className?: string | undefined;
}) {
  const [estado, setEstado] = React.useState<'idle' | 'copiado' | 'error'>('idle');

  const copiar = React.useCallback(() => {
    const escribir = navigator.clipboard?.writeText(valor);
    if (!escribir) {
      setEstado('error');
      return;
    }
    void escribir.then(
      () => {
        setEstado('copiado');
        window.setTimeout(() => setEstado('idle'), 2000);
      },
      () => setEstado('error'),
    );
  }, [valor]);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={copiar}
      className={className}
      aria-live="polite"
    >
      {estado === 'copiado' ? 'Copiado' : estado === 'error' ? 'No se pudo' : etiqueta}
    </Button>
  );
}
