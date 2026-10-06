'use client'

import { fechaHoraCorta, type HitoPedido } from '@/lib/pedidos-maquina';

/**
 * Timeline de timestamps del pedido.
 *
 * Horizontal con 3 o mas hitos, vertical con menos: en un telefono, dos hitos en
 * horizontal quedan ridiculos y cuatro en vertical ocupan media pantalla.
 */
export function TimelinePedido({ hitos }: { hitos: HitoPedido[] }) {
  if (hitos.length === 0) return null;

  if (hitos.length >= 3) {
    return (
      <ol className="flex items-start gap-1 overflow-x-auto pb-1">
        {hitos.map((h, i) => (
          <li key={`${h.etiqueta}-${i}`} className="flex min-w-0 flex-1 flex-col items-center text-center">
            <div className="flex w-full items-center">
              <span className={`h-2 flex-1 rounded-full ${i === 0 ? 'bg-transparent' : 'bg-[hsl(var(--primary))]'}`} />
              <span className="h-3 w-3 shrink-0 rounded-full bg-[hsl(var(--primary))]" />
              <span className={`h-2 flex-1 rounded-full ${i === hitos.length - 1 ? 'bg-transparent' : 'bg-[hsl(var(--primary))]'}`} />
            </div>
            <span className="mt-1 text-[11px] font-medium">{h.etiqueta}</span>
            <span className="text-[10px] text-muted-foreground">{fechaHoraCorta(h.fecha)}</span>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <ol className="space-y-2">
      {hitos.map((h, i) => (
        <li key={`${h.etiqueta}-${i}`} className="flex items-center gap-3">
          <span className="h-3 w-3 shrink-0 rounded-full bg-[hsl(var(--primary))]" />
          <span className="text-sm font-medium">{h.etiqueta}</span>
          <span className="ml-auto text-xs text-muted-foreground">{fechaHoraCorta(h.fecha)}</span>
        </li>
      ))}
    </ol>
  );
}
