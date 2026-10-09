'use client'

import * as React from 'react';
import { BottomSheet, Button, Label, Textarea } from '@repo/ui';
import { MIN_MOTIVO } from '@/lib/pedidos-maquina';

/**
 * Confirmacion con (o sin) motivo, en <BottomSheet>.
 *
 * Se usa BottomSheet y NO Dialog/AlertDialog: esos siguen siendo stubs en @repo/ui
 * (renderizan null, en silencio).
 *
 * `minimo` es la longitud minima del motivo cuando se pide: para RECHAZADO el
 * backend exige 10 caracteres, y no tiene sentido dejar que el usuario escriba
 * algo que va a rebotar.
 */
export function SheetAccion({
  abierto,
  onCerrar,
  titulo,
  descripcion,
  etiquetaMotivo,
  placeholder,
  requiereMotivo,
  textoConfirmar,
  destructivo,
  ocupado,
  onConfirmar,
}: {
  abierto: boolean;
  onCerrar: () => void;
  titulo: string;
  descripcion: string;
  etiquetaMotivo?: string;
  placeholder?: string;
  requiereMotivo?: boolean;
  textoConfirmar: string;
  destructivo?: boolean;
  ocupado?: boolean;
  onConfirmar: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = React.useState('');

  React.useEffect(() => {
    if (!abierto) setMotivo('');
  }, [abierto]);

  const valido = !requiereMotivo || motivo.trim().length >= MIN_MOTIVO;

  return (
    <BottomSheet
      abierto={abierto}
      onCerrar={() => (ocupado ? undefined : onCerrar())}
      titulo={titulo}
    >
      <div className="space-y-3 pb-2">
        <p className="text-sm text-muted-foreground">{descripcion}</p>

        {requiereMotivo ? (
          <div className="space-y-2">
            <Label htmlFor="motivo-accion">{etiquetaMotivo ?? 'Motivo'}</Label>
            <Textarea
              id="motivo-accion"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value.slice(0, 300))}
              placeholder={placeholder}
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {motivo.trim().length}/{MIN_MOTIVO} minimo
              </span>
              {motivo.length > 0 && !valido ? (
                <span role="alert" className="text-xs text-destructive">
                  Contale al cliente que paso (minimo {MIN_MOTIVO} caracteres)
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Fijos al pie del sheet: el contenido de arriba es el que scrollea. Sin esto, al escribir
            el motivo el teclado del celular empuja estos botones fuera de la parte visible. */}
        <div className="sticky bottom-0 -mx-5 mt-1 flex gap-2 border-t border-border bg-background px-5 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-3">
          <Button variant="outline" className="min-h-12 flex-1" onClick={onCerrar} disabled={ocupado}>
            Volver
          </Button>
          <Button
            variant={destructivo ? 'destructive' : 'default'}
            className="min-h-12 flex-1"
            onClick={() => onConfirmar(motivo.trim())}
            disabled={!valido || ocupado}
          >
            {ocupado ? 'Enviando...' : textoConfirmar}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
