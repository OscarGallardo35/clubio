'use client';

import * as React from 'react';
import Link from 'next/link';
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
  Button,
  Skeleton,
  toast,
} from '@repo/ui';
import { googleApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';
import type { GoogleEstado, UbicacionGoogle } from '@/types/api';

/**
 * Google Business Profile.
 *
 * Tres cosas que el flujo tiene y que no son obvias:
 * 1. El OAuth NO devuelve `accountId`/`locationId`: hay que LISTAR y ELEGIR cual sincronizar
 *    (`GET /google/ubicaciones` + `POST /google/ubicacion`). Sin elegir, no hay resenas.
 * 2. El callback de Google es publico y redirige a ESTA pagina con `?conectado=1` (el `ADMIN_URL`
 *    del backend). Por eso la pantalla vive en `/configuracion/google` y no en un tab.
 * 3. Todo esto esta detras de `@RequiereFeature('google_business')`: si el plan no la tiene, el
 *    backend responde 403 y se muestra tal cual (la feature es del plan, no un bug del panel).
 */
export default function GooglePage() {
  const [estado, setEstado] = React.useState<GoogleEstado | null>(null);
  const [ubicaciones, setUbicaciones] = React.useState<UbicacionGoogle[] | null>(null);
  // Dos errores SEPARADOS: el estado sale de nuestra DB (casi nunca falla) y las
  // ubicaciones dependen de Google. Un fallo de Google no tiene que tapar el estado
  // ni mostrarse como si el problema fuera la conexion.
  const [errorEstado, setErrorEstado] = React.useState<string | null>(null);
  const [errorUbicaciones, setErrorUbicaciones] = React.useState<string | null>(null);
  const [ocupado, setOcupado] = React.useState(false);
  const [aDesconectar, setADesconectar] = React.useState(false);
  const [aviso, setAviso] = React.useState<string | null>(null);

  const cargarEstado = React.useCallback(async () => {
    try {
      const e = await googleApi.estado();
      setEstado(e);
      setErrorEstado(null);
      return e;
    } catch (err) {
      const { status, mensaje } = normalizarError(err);
      if (status !== 401) setErrorEstado(mensaje);
      return null;
    }
  }, []);

  // Solo tiene sentido listar ubicaciones si hay token: sin conexion el backend da 400.
  const cargarUbicaciones = React.useCallback(async (conectado: boolean) => {
    if (!conectado) {
      setUbicaciones([]);
      setErrorUbicaciones(null);
      return;
    }
    try {
      const { data } = await googleApi.ubicaciones();
      setUbicaciones(data);
      setErrorUbicaciones(null);
    } catch (err) {
      const { status, mensaje } = normalizarError(err);
      setUbicaciones([]);
      if (status !== 401) setErrorUbicaciones(mensaje);
    }
  }, []);

  const cargar = React.useCallback(async () => {
    const e = await cargarEstado();
    await cargarUbicaciones(!!e?.conectado);
  }, [cargarEstado, cargarUbicaciones]);

  React.useEffect(() => {
    // El `?conectado=1` viene del redirect del callback de Google. Se lee de `window` y no de
    // `useSearchParams` para no obligar a un <Suspense> en el build (mismo criterio que useDueno).
    const params = new URLSearchParams(window.location.search);
    if (params.get('conectado') === '1') setAviso('Google quedo conectado. Elegi la ubicacion a sincronizar.');
    void cargar();
  }, [cargar]);

  React.useEffect(() => {
    if (errorEstado) toast.error('No pudimos leer el estado de Google', { description: errorEstado });
  }, [errorEstado]);

  React.useEffect(() => {
    if (errorUbicaciones)
      toast.error('No pudimos leer las ubicaciones de Google', { description: errorUbicaciones });
  }, [errorUbicaciones]);

  const conectar = React.useCallback(async () => {
    setOcupado(true);
    try {
      const { url } = await googleApi.conectar();
      if (!url) throw new Error('El backend no devolvio la URL de Google');
      window.location.href = url;
    } catch (e) {
      const { status, mensaje } = normalizarError(e);
      toast.error(status === 403 ? 'Tu plan no incluye Google Business' : mensaje);
      setOcupado(false);
    }
  }, []);

  const elegir = React.useCallback(
    async (u: UbicacionGoogle) => {
      setOcupado(true);
      try {
        await googleApi.seleccionar({
          accountId: u.accountId,
          locationId: u.locationId,
          accountName: u.accountName ?? undefined,
          locationName: u.locationName ?? undefined,
        });
        toast.success(`Sincronizando resenas de ${u.locationName ?? u.locationId}`);
        setAviso(null);
        await cargar();
      } catch (e) {
        const { mensaje } = normalizarError(e);
        toast.error(`No se pudo fijar la ubicacion. ${mensaje}`);
      } finally {
        setOcupado(false);
      }
    },
    [cargar],
  );

  const desconectar = React.useCallback(async () => {
    setOcupado(true);
    try {
      await googleApi.desconectar();
      toast.success('Google desconectado', { description: 'Dejamos de sincronizar resenas.' });
      setADesconectar(false);
      await cargar();
    } catch (e) {
      const { mensaje } = normalizarError(e);
      toast.error(`No se pudo desconectar. ${mensaje}`);
    } finally {
      setOcupado(false);
    }
  }, [cargar]);

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Google</h1>
          <p className="text-sm text-muted-foreground">
            Conecta la ficha de Google del local para mostrar y responder resenas.
          </p>
        </div>
        <Link href="/configuracion" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          Volver a Configuracion
        </Link>
      </header>

      {aviso ? (
        <p role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {aviso}
        </p>
      ) : null}

      {estado === null && !errorEstado ? <Skeleton className="h-32 w-full" /> : null}

      {estado ? (
        <div className="space-y-4 rounded-2xl border bg-card p-5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold">Estado</h2>
            {estado.conectado ? (
              <Badge className="bg-emerald-600 text-white">Conectado</Badge>
            ) : (
              <Badge variant="outline">Sin conectar</Badge>
            )}
            {!estado.configurado ? <Badge variant="outline">Falta configurar en el servidor</Badge> : null}
          </div>

          {estado.integracion ? (
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>
                Cuenta: <strong className="text-foreground">{estado.integracion.googleAccountName ?? estado.integracion.googleAccountId ?? '—'}</strong>
              </li>
              <li>
                Ubicacion:{' '}
                <strong className="text-foreground">
                  {estado.integracion.googleLocationName ?? estado.integracion.googleLocationId ?? 'sin elegir'}
                </strong>
              </li>
              {estado.integracion.conectadoEn ? (
                <li>Conectado el {new Date(estado.integracion.conectadoEn).toLocaleString('es-AR')}</li>
              ) : null}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Todavia no hay una cuenta de Google vinculada a este local.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {!estado.conectado ? (
              <Button onClick={() => void conectar()} disabled={ocupado || !estado.oauthDisponible}>
                {ocupado ? 'Abriendo Google...' : 'Conectar con Google'}
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => void cargar()} disabled={ocupado}>
                  Actualizar
                </Button>
                <Button
                  variant="outline"
                  className="text-destructive"
                  onClick={() => setADesconectar(true)}
                  disabled={ocupado}
                >
                  Desconectar
                </Button>
              </>
            )}
          </div>

          {!estado.oauthDisponible ? (
            <p className="text-xs text-muted-foreground">
              El servidor no tiene cargadas las credenciales de Google, asi que el boton queda
              deshabilitado. Hay que configurar `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`.
            </p>
          ) : null}
        </div>
      ) : null}

      {estado?.conectado ? (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Ubicaciones de la cuenta</h2>
          {errorUbicaciones ? (
            <p
              role="alert"
              className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            >
              No pudimos listar las ubicaciones: {errorUbicaciones}
            </p>
          ) : null}
          {ubicaciones === null ? (
            <Skeleton className="h-24 w-full" />
          ) : errorUbicaciones ? null : ubicaciones.length === 0 ? (
            <p className="rounded-xl border px-4 py-3 text-sm text-muted-foreground">
              La cuenta no tiene ubicaciones cargadas en Google Business.
            </p>
          ) : (
            <ul className="divide-y rounded-2xl border bg-card">
              {ubicaciones.map((u) => {
                const actual = estado.integracion?.googleLocationId === u.locationId;
                return (
                  <li key={`${u.accountId}-${u.locationId}`} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {u.locationName ?? u.locationId}
                        {actual ? <span className="ml-2 text-xs text-muted-foreground">(la que sincroniza)</span> : null}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {u.accountName ?? u.accountId}
                        {u.direccion ? ` · ${u.direccion}` : ''}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => void elegir(u)}
                      disabled={ocupado || actual}
                    >
                      {actual ? 'En uso' : 'Usar esta'}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      <AlertDialog open={aDesconectar} onOpenChange={setADesconectar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desconectar Google?</AlertDialogTitle>
            <AlertDialogDescription>
              El local deja de sincronizar resenas. Podes volver a conectarlo cuando quieras (hay que
              elegir la ubicacion otra vez).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void desconectar()}
              disabled={ocupado}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {ocupado ? 'Desconectando...' : 'Desconectar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
