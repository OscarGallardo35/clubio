'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Label } from '@repo/ui';
import { superadminApi } from '@/lib/api';
import { RUTA_INICIO } from '@/lib/constants';
import { normalizarError } from '@/lib/errores';

/**
 * Login del operador: email + password y, si el backend lo pide, el paso de 2FA.
 *
 * Mismo patron que el login del dueno (la referencia que pidio el usuario):
 *  - El `challengeToken` (vive 5 minutos) queda en MEMORIA y no en la URL.
 *  - Los dos pasos son dos `<form>` distintos: el de 2FA no reenvia email ni password.
 *  - `volver` llega por PROP (lo lee la pagina en el servidor) y no con
 *    `useSearchParams`, que obligaria a un <Suspense> para poder prerenderizar.
 *
 * La diferencia con el dueno: aca NO se pide el local. La identidad del super-admin es
 * global (no tiene negocio), asi que el form son dos campos y se acabó.
 */
export function FormularioLogin({ volver }: { volver?: string | undefined }) {
  const router = useRouter();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [codigo, setCodigo] = React.useState('');
  const [challenge, setChallenge] = React.useState<string | null>(null);
  const [enviando, setEnviando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Solo rutas internas: un `volver` absoluto seria un redirect abierto.
  const destino = volver && volver.startsWith('/') ? volver : RUTA_INICIO;

  const puedeEnviarCredenciales = email.trim().length > 3 && password.length >= 6 && !enviando;
  const puedeEnviarCodigo = /^\d{6}$/.test(codigo) && !enviando;

  /** 401 y 429 no significan lo mismo: uno se arregla escribiendo bien, el otro esperando. */
  function mensajeDeError(status: number, mensaje: string): string {
    if (status === 0) return `No pudimos conectar con el servidor. ${mensaje}`;
    if (status === 401) return 'Credenciales invalidas.';
    if (status === 429) return 'Demasiados intentos. Espera un minuto y volve a probar.';
    if (status === 403) return mensaje || 'Cuenta bloqueada por intentos fallidos.';
    return mensaje;
  }

  async function enviarCredenciales(evento: React.FormEvent) {
    evento.preventDefault();
    if (!puedeEnviarCredenciales) return;
    setEnviando(true);
    setError(null);
    try {
      const r = await superadminApi.login({ email: email.trim(), password });
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
      await superadminApi.verificar2FA({ challengeToken: challenge, codigo });
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
          placeholder="operador@clubio.lat"
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
