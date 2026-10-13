'use client';

import * as React from 'react';
import Link from 'next/link';
import { Badge, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui';
import { superadminApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';
import { desenvolverLocal } from '@/lib/normalizar';
import { TabResumen } from '@/components/locales/TabResumen';
import { TabConfiguracion } from '@/components/locales/TabConfiguracion';
import { TabCarta } from '@/components/locales/TabCarta';
import { TabEmpleados } from '@/components/locales/TabEmpleados';
import { TabPlan } from '@/components/locales/TabPlan';
import { TabBranding } from '@/components/locales/TabBranding';
import type { LocalDetalle } from '@/types/api';

const PESTANAS = [
  { id: 'resumen', etiqueta: 'Resumen' },
  { id: 'plan', etiqueta: 'Plan' },
  { id: 'configuracion', etiqueta: 'Configuracion' },
  { id: 'carta', etiqueta: 'Carta' },
  { id: 'empleados', etiqueta: 'Empleados' },
  { id: 'branding', etiqueta: 'Branding' },
] as const;

/**
 * Detalle de UN local: todo lo que el operador necesita para dejarlo vendible, en pestanas.
 *
 * El detalle se carga UNA vez en esta pantalla (la cabecera lo necesita) y las pestanas de
 * datos pesados (Carta, Empleados) cargan lo suyo al montarse: Radix desmonta el contenido
 * inactivo, asi que no se piden tres listas para mirar el Resumen.
 *
 * `TabsList` NO lleva `w-max`: el componente de `@repo/ui` ya scrollea adentro (`flex w-full`
 * + `overflow-x-auto` + triggers `shrink-0`). Un `w-max` aca volveria a desbordar el
 * documento en mobile, que es el bug que el repo ya pago una vez.
 */
export default function DetalleLocalPage({ params }: { params: { negocioId: string } }) {
  const negocioId = params.negocioId;
  const [detalle, setDetalle] = React.useState<LocalDetalle | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<string>('resumen');

  const cargar = React.useCallback(async () => {
    try {
      const r = await superadminApi.detalle(negocioId);
      // `desenvolverLocal` y NO `normalizarLocalDetalle`: el detalle viene envuelto
      // (`{ local, configuracion, contadores, sucursales }`) y hay que desenvolverlo y pegarle
      // los hermanos. Con la normalizacion sola, la pantalla muestra un local vacio.
      setDetalle(desenvolverLocal(r));
      setError(null);
    } catch (e) {
      const { status, mensaje } = normalizarError(e);
      if (status === 401) return;
      setError(
        status === 404
          ? 'No encontramos ese local. Puede que lo hayan eliminado.'
          : mensaje,
      );
    }
  }, [negocioId]);

  React.useEffect(() => {
    void cargar();
  }, [cargar]);

  if (error && detalle === null) {
    return (
      <div className="flex w-full flex-col gap-4">
        <Link href="/locales" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          ← Todos los locales
        </Link>
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      </div>
    );
  }

  if (detalle === null) {
    return (
      <div className="flex w-full flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <header className="space-y-2">
        <Link
          href="/locales"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Todos los locales
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h1 className="truncate text-2xl font-semibold">{detalle.nombre || 'Local'}</h1>
            <p className="break-all text-sm text-muted-foreground">/{detalle.slug}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{detalle.plan}</Badge>
            {detalle.activo ? (
              <Badge variant="success">activo</Badge>
            ) : (
              <Badge variant="secondary">inactivo</Badge>
            )}
          </div>
        </div>
      </header>

      {error && detalle !== null ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="gap-1" aria-label="Secciones del local">
          {PESTANAS.map((p) => (
            <TabsTrigger key={p.id} value={p.id}>
              {p.etiqueta}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="resumen">
          <TabResumen negocioId={negocioId} detalle={detalle} onRefrescar={cargar} />
        </TabsContent>

        <TabsContent value="plan">
          <TabPlan negocioId={negocioId} onGuardado={cargar} />
        </TabsContent>

        <TabsContent value="configuracion">
          <TabConfiguracion negocioId={negocioId} detalle={detalle} onGuardado={cargar} />
        </TabsContent>

        <TabsContent value="carta">
          <TabCarta negocioId={negocioId} />
        </TabsContent>

        <TabsContent value="empleados">
          <TabEmpleados negocioId={negocioId} />
        </TabsContent>

        <TabsContent value="branding">
          <TabBranding negocioId={negocioId} detalle={detalle} onGuardado={cargar} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
