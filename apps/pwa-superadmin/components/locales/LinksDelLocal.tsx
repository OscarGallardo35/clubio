'use client';

import * as React from 'react';
import { BotonCopiar } from '@/components/BotonCopiar';
import { linkCorto, linksDeLocal } from '@/lib/dominios';

/**
 * Los tres links listos para mostrar de un local demo.
 *
 * Se muestran SIN protocolo (mas cortos y legibles) y se copian CON protocolo (es lo que
 * el operador pega en WhatsApp y tiene que abrir). El valor copiado y el texto en pantalla
 * salen del mismo `linksDeLocal`, asi no pueden divergir.
 */
export function LinksDelLocal({ slug }: { slug: string }) {
  const links = linksDeLocal(slug);
  return (
    <ul className="flex flex-col gap-2" data-testid="links-demo">
      {links.map((link) => (
        <li
          key={link.url}
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3"
        >
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {link.etiqueta}
            </p>
            <p className="break-all font-mono text-sm">{linkCorto(link.url)}</p>
            <p className="text-xs text-muted-foreground">{link.para}</p>
          </div>
          <BotonCopiar valor={link.url} />
        </li>
      ))}
    </ul>
  );
}
