'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Label } from '@repo/ui';
import { duenoApi } from '@/lib/api';
import { rutaDe } from '@/lib/tenant';
import { RUTA_INICIO } from '@/lib/constants';
import { normalizarError } from '@/lib/errores';

/**
 * Login del dueno: email + password y, si el backend lo pide, el paso de 2FA.
 *
 * El `challengeToken` (vive 5 minutos) queda en MEMORIA y no en la URL: es una credencial
 * temporal, y una URL termina en el historial, en los logs del proxy y en el `Referer`. Si se
 * recarga el paso 2, se vuelve a empezar (son 10 segundos).
 *
 * Los dos pasos son dos `<form>` distintos (no un boton que cambia de sentido): el de 2FA no
 * reenvia email ni password.
 *
 * `volver` llega por PROP (lo lee la pagina en el servidor) y no con `useSearchParams`: ese hook
 * obliga a envolver todo en un <Suspense> para poder prerenderizar y es una fuente clasica de
 * "prerender-error".
 */
export function FormularioLogin({ tenant, volver }: { tenant: string; volver?: string | undefined }) {
  const router = useRouter();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [codigo, setCodigo] = React.useState('');
  const [challenge, setChallenge] = React.useState<string | null>(null);
  const [enviando, setEnviando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Solo rutas internas: un `volver` absoluto seria un redirect abierto.
  // El destino por defecto es el dashboard DEL TENANT, no la raiz.
  const destino = volver && volver.startsWith('/') ? volver : rutaDe(tenant, RUTA_INICIO);

  const puedeEnviarCredenciales =
    email.trim().length > 3 && password.length >= 6 && tenant.trim().length > 0 && !enviando;
  const puedeEnviarCodigo = /^\d{6}$/.test(codigo) && !enviando;

  /** 401 y 429 no significan lo mismo: uno se arregla escribiendo bien, el otro esperando. */
  function mensajeDeError(status: number, mensaje: string): string {
    if (status === 0) return `No pudimos conectar con el servidor. ${mensaje}`;
    if (status === 401) return 'Credenciales invalidas.';
    if (status === 429) return 'Demasiados intentos. Espera un minuto y volve a probar.';
    return mensaje;
  }

  async function enviarCredenciales(evento: React.FormEvent) {
    evento.preventDefault();
    if (!puedeEnviarCredenciales) return;
    setEnviando(true);
    setError(null);
    try {
      // El local ya NO se pide en el form: viene del path (`/<tenant>/login`).
      const r = await duenoApi.login({ email: email.trim(), password, negocioSlug: tenant });
      if (r.requiere2FA && r.challengeToken) {
        setChallenge(r.challengeToken);
        setEnviando(false);
        return;
      }
      // Sin 2FA la cookie ya viajo en la respuesta; el guard del layout hace el resto.
      router.replace(destino);
    } catch (err) {
      const { status, mensaje } = normalizarError(err);
      setError(mensajeDeError(status, mensaje));
      setEnviando(false);
    }
  }

  async function enviarCodigo(evento: React.FormEvent) {
    evento.preventDefault();
    if (!puedeEnviarCodigo || !challenge) return;
    setEnviando(true);
    setError(null);
    try {
      await duenoApi.verificar2FA({ challengeToken: challenge, codigo });
      router.replace(destino);
    } catch (err) {
      const { status, mensaje } = normalizarError(err);
      setError(mensajeDeError(status, mensaje));
      setCodigo('');
      setEnviando(false);
    }
  }

  if (challenge) {
    return (
      <form onSubmit={enviarCodigo} className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Ingresa el codigo de 6 digitos de tu app de autenticacion.
        </p>
        <div className="space-y-2">
          <Label htmlFor="codigo">Codigo</Label>
          <Input
            id="codigo"
            name="codigo"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            maxLength={6}
            className="text-center text-2xl tracking-[0.4em]"
            placeholder="000000"
            autoFocus
            required
          />
        </div>

        {error ? (
          <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={!puedeEnviarCodigo} className="min-h-12 w-full">
          {enviando ? 'Verificando...' : 'Verificar'}
        </Button>
        <button
          type="button"
          onClick={() => {
            setChallenge(null);
            setCodigo('');
            setError(null);
          }}
          className="w-full text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Volver al inicio de sesion
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={enviarCredenciales} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="carlos@barlaesquina.com"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Contrasena</Label>
        <Input
          id="password"
          name="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          placeholder="••••••••"
          required
        />
      </div>

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={!puedeEnviarCredenciales} className="min-h-12 w-full">
        {enviando ? 'Ingresando...' : 'Ingresar'}
      </Button>
    </form>
  );
}
