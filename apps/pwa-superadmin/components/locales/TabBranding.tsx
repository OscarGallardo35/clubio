'use client';

import * as React from 'react';
import { Button, Input, Label, Skeleton, Switch, toast } from '@repo/ui';
import { THEME_NEUTRO } from '@repo/types';
import type { TenantTheme } from '@repo/types';
import { superadminApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';
import type { LocalDetalle } from '@/types/api';

/**
 * Branding del local: la identidad de la marca y el theme de la tarjeta del cliente.
 *
 * DOS guardados distintos, y a proposito:
 *  - La identidad (`colorPrimario`/`colorSecundario`) son columnas del NEGOCIO: es la marca
 *    que usan el menu, el admin y los mails -> `PATCH /locales/:id`.
 *  - El `theme` es el JSON que dibuja la TARJETA de sellos del cliente (fondo, acento,
 *    textos, imagen, si muestra puntos) -> `PATCH /locales/:id/theme`.
 * Separarlos evita que tocar un color de marca pise la personalizacion de la tarjeta.
 *
 * LAS DOS TARJETAS SON INDEPENDIENTES. Cada formulario tiene su estado y su boton de guardar, y
 * NO llevan `key` en el contenedor: antes, guardar una cambiaba la `key` del wrapper y REMONTABA
 * la hermana, perdiendo lo que el operador tenia sin guardar en la otra. Como el detalle solo se
 * re-carga despues de guardar, el estado del formulario sembrado al montar sigue siendo valido.
 *
 * NADA de JSON crudo: el operador arma la demo, no edita un schema. Cada campo del theme
 * tiene su control guiado, y hay una vista previa con los colores elegidos.
 */
export function TabBranding({
  negocioId,
  detalle,
  onGuardado,
}: {
  negocioId: string;
  detalle: LocalDetalle | null;
  onGuardado: () => void | Promise<void>;
}) {
  if (detalle === null) return <Skeleton className="h-72 w-full" />;

  return (
    <div className="space-y-5">
      <FormIdentidad
        negocioId={negocioId}
        colorPrimario={detalle.colorPrimario}
        colorSecundario={detalle.colorSecundario}
        onGuardado={onGuardado}
      />
      <FormTheme negocioId={negocioId} theme={detalle.theme ?? null} onGuardado={onGuardado} />
    </div>
  );
}

function FormIdentidad({
  negocioId,
  colorPrimario,
  colorSecundario,
  onGuardado,
}: {
  negocioId: string;
  colorPrimario: string;
  colorSecundario: string;
  onGuardado: () => void | Promise<void>;
}) {
  const [primario, setPrimario] = React.useState(colorPrimario);
  const [secundario, setSecundario] = React.useState(colorSecundario);
  const [guardando, setGuardando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Los colores del NEGOCIO son columnas NOT NULL con default (`colorPrimario`/`colorSecundario`)
  // y el DTO exige hex: un `null` ahi NO borra, el backend responde 500. Por eso aca no se puede
  // vaciar un color (a diferencia del WhatsApp, que si acepta `null` para borrar).
  const valido = hexOk(primario) && hexOk(secundario) && !guardando;

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!valido) return;
    setGuardando(true);
    setError(null);
    try {
      await superadminApi.actualizarLocal(negocioId, {
        colorPrimario: primario,
        colorSecundario: secundario,
      });
      toast.success('Identidad guardada');
      await onGuardado();
    } catch (e) {
      setError(normalizarError(e).mensaje);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-5 rounded-2xl border bg-card p-5">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">Identidad del local</h2>
        <p className="text-sm text-muted-foreground">
          Los colores de la marca: los usa el menu del cliente y el panel del dueno.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <CampoColor
          id="brand-primario"
          etiqueta="Color primario"
          valor={primario}
          onChange={setPrimario}
        />
        <CampoColor
          id="brand-secundario"
          etiqueta="Color secundario"
          valor={secundario}
          onChange={setSecundario}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Los dos colores son obligatorios: los usa el menu del cliente y el panel del dueno, asi que
        no se pueden dejar vacios (el backend solo acepta un hex de 6 digitos).
      </p>

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={!valido}>
          {guardando ? 'Guardando...' : 'Guardar identidad'}
        </Button>
      </div>
    </form>
  );
}

function FormTheme({
  negocioId,
  theme,
  onGuardado,
}: {
  negocioId: string;
  theme: TenantTheme | null;
  onGuardado: () => void | Promise<void>;
}) {
  const base = theme?.colores ?? THEME_NEUTRO.colores;
  const [bg, setBg] = React.useState(base.bg);
  const [accent, setAccent] = React.useState(base.accent);
  const [brandDark, setBrandDark] = React.useState(base.brandDark);
  const [text, setText] = React.useState(base.text);
  const [textMuted, setTextMuted] = React.useState(base.textMuted);
  const [imagenFondo, setImagenFondo] = React.useState(theme?.imagenFondo ?? '');
  const [mostrarPuntos, setMostrarPuntos] = React.useState(theme?.mostrarPuntos !== false);
  const [guardando, setGuardando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // `textMuted` acepta un color con alpha ("rgba(...)") o un hex: no se valida como hex.
  const valido =
    hexOk(bg) && hexOk(accent) && hexOk(brandDark) && hexOk(text) && textMuted.trim() !== '' && !guardando;

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!valido) return;
    setGuardando(true);
    setError(null);
    try {
      const nuevo: TenantTheme = {
        colores: { bg, accent, brandDark, text, textMuted: textMuted.trim() },
        sello: { rotacionBase: 0, forma: 'circulo' },
        imagenFondo: imagenFondo.trim() === '' ? null : imagenFondo.trim(),
        mostrarPuntos,
      };
      await superadminApi.actualizarTheme(negocioId, nuevo);
      toast.success('Theme de la tarjeta guardado');
      await onGuardado();
    } catch (e) {
      setError(normalizarError(e).mensaje);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-5 rounded-2xl border bg-card p-5">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">Tarjeta del cliente</h2>
        <p className="text-sm text-muted-foreground">
          Como se ve la tarjeta de sellos que el cliente abre desde el QR. Sin colores cargados,
          el cliente ve el diseno por defecto.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <CampoColor id="theme-bg" etiqueta="Fondo de la tarjeta" valor={bg} onChange={setBg} />
        <CampoColor id="theme-accent" etiqueta="Acento (sellos)" valor={accent} onChange={setAccent} />
        <CampoColor
          id="theme-brand"
          etiqueta="Marca oscura (barra del progreso)"
          valor={brandDark}
          onChange={setBrandDark}
        />
        <CampoColor id="theme-text" etiqueta="Texto principal" valor={text} onChange={setText} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="theme-textmuted">Texto secundario</Label>
        <Input
          id="theme-textmuted"
          value={textMuted}
          onChange={(e) => setTextMuted(e.target.value.slice(0, 40))}
          autoCapitalize="none"
          spellCheck={false}
          className="font-mono"
          placeholder="rgba(255,255,255,0.45)"
        />
        <p className="text-xs text-muted-foreground">
          Acepta un color con transparencia (ej: rgba(255,255,255,0.45)).
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="theme-fondo">Imagen de fondo (opcional)</Label>
        <Input
          id="theme-fondo"
          value={imagenFondo}
          onChange={(e) => setImagenFondo(e.target.value)}
          autoCapitalize="none"
          spellCheck={false}
          placeholder="/tenants/<slug>/bg.webp"
        />
        <p className="text-xs text-muted-foreground">
          Ruta publica de la imagen. Vacio = solo el color de fondo.
        </p>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="theme-puntos">Mostrar los puntos</Label>
          <p className="text-xs text-muted-foreground">
            Apagalo en los clubes que premian solo por visitas.
          </p>
        </div>
        <Switch id="theme-puntos" checked={mostrarPuntos} onCheckedChange={setMostrarPuntos} />
      </div>

      {/* Vista previa: con los colores elegidos, para no guardar a ciegas. */}
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Vista previa</p>
        <div
          className="rounded-2xl border p-4"
          style={{ backgroundColor: hexOk(bg) ? bg : '#111827', color: text }}
          data-testid="preview-theme"
        >
          <p className="text-sm font-semibold">Club del local</p>
          <div className="mt-3 flex items-center gap-2" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <span
                key={i}
                className="flex size-8 items-center justify-center rounded-full border"
                style={{
                  borderColor: brandDark,
                  backgroundColor: i < 3 ? accent : 'transparent',
                }}
              >
                {i < 3 ? (
                  <span style={{ color: brandDark }} className="text-xs font-bold">
                    ✓
                  </span>
                ) : null}
              </span>
            ))}
          </div>
          <div
            className="mt-3 h-2 w-full overflow-hidden rounded-full"
            style={{ backgroundColor: brandDark }}
          >
            <div className="h-full w-3/5" style={{ backgroundColor: accent }} />
          </div>
          <p className="mt-2 text-xs" style={{ color: textMuted }}>
            Llevas 3 de 5 · Te faltan 2 para tu premio
          </p>
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={!valido}>
          {guardando ? 'Guardando...' : 'Guardar tarjeta'}
        </Button>
      </div>
    </form>
  );
}

function hexOk(valor: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(valor);
}

/** Hex + selector visual nativo (el selector es HTML, no suma dependencias). */
function CampoColor({
  id,
  etiqueta,
  valor,
  onChange,
}: {
  id: string;
  etiqueta: string;
  valor: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{etiqueta}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${etiqueta} (selector)`}
          value={hexOk(valor) ? valor : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border bg-background p-1"
        />
        <Input
          id={id}
          value={valor}
          onChange={(e) => onChange(e.target.value.slice(0, 7))}
          autoCapitalize="none"
          spellCheck={false}
          className="font-mono"
        />
      </div>
      {!hexOk(valor) && valor !== '' ? (
        <p role="alert" className="text-xs text-destructive">
          El color va en hex de 6 digitos (ej: #F59E0B).
        </p>
      ) : null}
    </div>
  );
}
