'use client'

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Label } from '@repo/ui';
import { staffApi } from '@/lib/api';
import { rutaDe } from '@/lib/tenant';
import { RUTA_INICIO } from '@/lib/constants';
import { normalizarError } from '@/lib/errores';
import { useEmpleadoStore } from '@/stores/empleadoStore';

/**
 * Formulario de login por PIN.
 *
 * `inputMode="numeric"` + `pattern="[0-9]*"` abren el teclado numerico en mobile
 * (con `type="number"` el navegador agrega flechitas y acepta `e`/`-`).
 * `autoComplete="one-time-code"` hace que iOS/Android ofrezcan el codigo.
 *
 * `volver` llega por PROP (lo lee la pagina en el servidor) y no con
 * `useSearchParams`: ese hook obliga a envolver todo en un <Suspense> para poder
 * prerenderizar, y es una fuente clasica de "prerender-error".
 */
// exactOptionalPropertyTypes: un opcional que puede recibir `undefined` se declara
// `?: T | undefined` (regla de la casa).
export function FormularioLogin({ tenant, volver }: { tenant: string; volver?: string | undefined }) {
  const router = useRouter();
  const fijarToken = useEmpleadoStore((st) => st.fijarToken);
  const [pin, setPin] = React.useState('');
  const [enviando, setEnviando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const puedeEnviar = tenant.trim().length > 0 && /^\d{4,8}$/.test(pin) && !enviando;

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!puedeEnviar) return;
    setEnviando(true);
    setError(null);
    try {
      // El local ya NO se pide en el form: viene del path (`/<tenant>/login`).
      const r = await staffApi.login({ negocioSlug: tenant, pin });
      // El token queda en memoria para el handshake del WS; la cookie (HttpOnly) ya
      // viajo en la respuesta y es la que autentica el resto.
      fijarToken(r.accessToken);
      router.replace(volver && volver.startsWith('/') ? volver : rutaDe(tenant, RUTA_INICIO));
    } catch (err) {
      const { status, mensaje } = normalizarError(err);
      // 0 = no se pudo hablar con el backend: se dice distinto que un PIN mal.
      setError(status === 0 ? `No pudimos conectar con el servidor. ${mensaje}` : mensaje);
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="pin">PIN</Label>
        <Input
          id="pin"
          name="pin"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          maxLength={8}
          className="text-center text-2xl tracking-[0.4em]"
          placeholder="0000"
          required
        />
      </div>

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={!puedeEnviar} className="min-h-12 w-full">
        {enviando ? 'Ingresando...' : 'Ingresar'}
      </Button>
    </form>
  );
}
