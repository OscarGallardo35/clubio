'use client';

import * as React from 'react';
import {
  Button,
  DialogFooter,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui';
import { superadminApi } from '@/lib/api';
import { desenvolverLocal } from '@/lib/normalizar';
import { normalizarError } from '@/lib/errores';
import { limpiarSlug, slugValido, sugerirSlug } from '@/lib/slug';
import { PLANES } from '@/types/api';
import type { PlanLocal } from '@/types/api';
import { toast } from '@repo/ui';

/** Lo minimo del local que el formulario necesita para precargarse. */
export interface LocalEditable {
  id: string;
  nombre: string;
  slug: string;
  plan: PlanLocal;
  colorPrimario?: string | null;
  colorSecundario?: string | null;
  numeroAtendiente?: string | null;
}

const COLOR_PRIMARIO_DEFECTO = '#E11D48';
const COLOR_SECUNDARIO_DEFECTO = '#111827';

/**
 * Alta y edicion de un local.
 *
 * DOS MODOS en el mismo componente (no dos pantallas casi iguales):
 *  - `local === null` => WIZARD de alta en 2 pasos (identidad -> plan y marca). El wizard no
 *    es decorativo: el slug se sugiere del nombre y se valida ANTES de mandar, porque el slug
 *    es la URL del cliente y un 400 del backend por un slug invalido no dice cual era el
 *    problema.
 *  - `local !== null` => edicion en un solo paso. El slug se muestra bloqueado: ya esta en la
 *    URL que el local pudo haber impreso en un QR.
 *
 * Al crear, `onCreado` recibe el local REAL que devolvio el backend (id + slug). Eso es lo que
 * permite encadenar la provision ("Crear demo") sin obligar al operador a buscar el local en
 * la lista justo despues de crearlo.
 */
export function FormularioLocal({
  local,
  onCreado,
  onGuardado,
  onCancelar,
}: {
  local: LocalEditable | null;
  onCreado?: ((nuevo: { id: string; nombre: string; slug: string }) => void) | undefined;
  onGuardado?: (() => void | Promise<void>) | undefined;
  onCancelar: () => void;
}) {
  const editando = local !== null;
  const [paso, setPaso] = React.useState(1);

  const [nombre, setNombre] = React.useState(local?.nombre ?? '');
  const [slug, setSlug] = React.useState(local?.slug ?? '');
  const [slugTocado, setSlugTocado] = React.useState(editando);
  const [plan, setPlan] = React.useState<PlanLocal>(local?.plan ?? 'PRO');
  const [colorPrimario, setColorPrimario] = React.useState(
    local?.colorPrimario ?? COLOR_PRIMARIO_DEFECTO,
  );
  const [colorSecundario, setColorSecundario] = React.useState(
    local?.colorSecundario ?? COLOR_SECUNDARIO_DEFECTO,
  );
  const [whatsapp, setWhatsapp] = React.useState(local?.numeroAtendiente ?? '');

  const [guardando, setGuardando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const slugOk = slugValido(slug);
  const paso1Valido = nombre.trim().length >= 2 && slugOk;
  const puedeGuardar = nombre.trim().length >= 2 && !guardando;
  // Los colores son columnas NOT NULL con default: NO pueden quedar vacios (el backend responde
  // 400 "no se puede vaciar"). Un campo vaciado se avisa y bloquea el guardado; nunca se manda
  // `null` ni un string vacio.
  const hexOk = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);
  const coloresOk = hexOk(colorPrimario) && hexOk(colorSecundario);
  const MENSAJE_COLORES =
    'Los colores no pueden quedar vacios: elegi un hex de 6 digitos (ej. #E11D48) o usa el selector.';

  async function crear(evento: React.FormEvent) {
    evento.preventDefault();
    if (!paso1Valido || guardando) return;
    if (!coloresOk) {
      setError(MENSAJE_COLORES);
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const respuesta = await superadminApi.crearLocal({
        nombre: nombre.trim(),
        slug,
        plan,
        colorPrimario,
        colorSecundario,
        ...(whatsapp.trim() !== '' ? { numeroAtendiente: whatsapp.trim() } : {}),
      });
      const nuevo = desenvolverLocal(respuesta);
      toast.success(`${nombre.trim()} quedo creado`, {
        description: 'Ya podes provisionarlo para la demo.',
      });
      if (onCreado && nuevo.id) {
        onCreado({ id: nuevo.id, nombre: nuevo.nombre || nombre.trim(), slug: nuevo.slug || slug });
      } else {
        await onGuardado?.();
      }
    } catch (e) {
      const { status, mensaje } = normalizarError(e);
      setError(status === 409 ? `${mensaje} (¿ya existe un local con ese slug?)` : mensaje);
      setGuardando(false);
    }
  }

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!puedeGuardar || !local || guardando) return;
    // Los colores son NOT NULL: si el operador los vacio, se avisa ANTES de mandar (el backend
    // responde 400) y no se guarda nada. Antes se omitian en silencio y el cambio no se notaba.
    if (!coloresOk) {
      setError(MENSAJE_COLORES);
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const wa = whatsapp.trim();
      const waAntes = (local.numeroAtendiente ?? '').trim();
      await superadminApi.actualizarLocal(local.id, {
        nombre: nombre.trim(),
        plan,
        // Los colores ya se validaron arriba: van siempre como hex valido.
        colorPrimario,
        colorSecundario,
        // WhatsApp: si quedo con valor, se manda; si el operador BORRO uno que existia, se manda
        // `null` EXPLICITO para que el backend lo limpie; si ya estaba vacio y sigue vacio, no se
        // toca (un `null` a ciegas borraria el numero que cargo el dueno desde otra pantalla).
        ...(wa !== ''
          ? { numeroAtendiente: wa }
          : waAntes !== ''
            ? { numeroAtendiente: null }
            : {}),
      });
      toast.success('Local actualizado');
      await onGuardado?.();
    } catch (e) {
      setError(normalizarError(e).mensaje);
    } finally {
      setGuardando(false);
    }
  }

  if (editando) {
    return (
      <form onSubmit={guardar} className="space-y-4">
        <CampoNombre
          nombre={nombre}
          setNombre={setNombre}
          slug={slug}
          setSlug={setSlug}
          slugTocado={slugTocado}
          setSlugTocado={setSlugTocado}
          slugBloqueado
        />
        <CampoPlanYColores
          plan={plan}
          setPlan={setPlan}
          colorPrimario={colorPrimario}
          setColorPrimario={setColorPrimario}
          colorSecundario={colorSecundario}
          setColorSecundario={setColorSecundario}
        />
        <CampoWhatsApp whatsapp={whatsapp} setWhatsapp={setWhatsapp} />
        {error ? <ErrorForm error={error} /> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancelar} disabled={guardando}>
            Cancelar
          </Button>
          <Button type="submit" disabled={!puedeGuardar}>
            {guardando ? 'Guardando...' : 'Guardar cambios'}
          </Button>
        </DialogFooter>
      </form>
    );
  }

  return (
    <form onSubmit={crear} className="space-y-4">
      <Pasos paso={paso} />

      {paso === 1 ? (
        <>
          <CampoNombre
            nombre={nombre}
            setNombre={setNombre}
            slug={slug}
            setSlug={setSlug}
            slugTocado={slugTocado}
            setSlugTocado={setSlugTocado}
            slugBloqueado={false}
          />
          <CampoWhatsApp whatsapp={whatsapp} setWhatsapp={setWhatsapp} />
        </>
      ) : (
        <CampoPlanYColores
          plan={plan}
          setPlan={setPlan}
          colorPrimario={colorPrimario}
          setColorPrimario={setColorPrimario}
          colorSecundario={colorSecundario}
          setColorSecundario={setColorSecundario}
        />
      )}

      {error ? <ErrorForm error={error} /> : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </Button>
        {paso === 2 ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => setPaso(1)}
            disabled={guardando}
          >
            Atras
          </Button>
        ) : null}
        {paso === 1 ? (
          <Button type="button" onClick={() => setPaso(2)} disabled={!paso1Valido}>
            Siguiente
          </Button>
        ) : (
          <Button type="submit" disabled={!paso1Valido || !coloresOk || guardando}>
            {guardando ? 'Creando...' : 'Crear local'}
          </Button>
        )}
      </DialogFooter>
    </form>
  );
}

function Pasos({ paso }: { paso: number }) {
  return (
    <ol className="flex items-center gap-3 text-xs text-muted-foreground" data-testid="pasos-local">
      {['Identidad', 'Plan y marca'].map((etiqueta, indice) => {
        const numeroPaso = indice + 1;
        const activo = numeroPaso === paso;
        return (
          <li key={etiqueta} className="flex items-center gap-2">
            <span
              aria-current={activo ? 'step' : undefined}
              className={
                activo
                  ? 'flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground'
                  : 'flex size-6 items-center justify-center rounded-full border text-xs font-semibold'
              }
            >
              {numeroPaso}
            </span>
            <span className={activo ? 'font-medium text-foreground' : undefined}>{etiqueta}</span>
          </li>
        );
      })}
    </ol>
  );
}

function CampoNombre({
  nombre,
  setNombre,
  slug,
  setSlug,
  slugTocado,
  setSlugTocado,
  slugBloqueado,
}: {
  nombre: string;
  setNombre: (v: string) => void;
  slug: string;
  setSlug: (v: string) => void;
  slugTocado: boolean;
  setSlugTocado: (v: boolean) => void;
  slugBloqueado: boolean;
}) {
  const slugOk = slugValido(slug);
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="local-nombre">Nombre</Label>
        <Input
          id="local-nombre"
          value={nombre}
          onChange={(e) => {
            const v = e.target.value.slice(0, 80);
            setNombre(v);
            // Solo autocompleta el slug mientras el operador no lo haya tocado: si ya lo
            // escribio a mano, cambiarle lo tipeado al editar el nombre es una traicion.
            if (!slugTocado) setSlug(sugerirSlug(v));
          }}
          placeholder="Lomitos del Barrio"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="local-slug">Slug (la URL del cliente)</Label>
        <Input
          id="local-slug"
          value={slug}
          onChange={(e) => {
            setSlugTocado(true);
            if (!slugBloqueado) setSlug(limpiarSlug(e.target.value));
          }}
          readOnly={slugBloqueado}
          aria-readonly={slugBloqueado}
          autoCapitalize="none"
          spellCheck={false}
          className={slugBloqueado ? 'bg-muted text-muted-foreground' : undefined}
          placeholder="lomitos-del-barrio"
          required
        />
        <p className="text-xs text-muted-foreground">
          El cliente entra a <strong>app.clubio.lat/{slug || 'tu-slug'}</strong>
          {slugBloqueado
            ? ' — el slug no se cambia: ya esta en la URL y en el QR que repartiste.'
            : ' — se sugiere del nombre y no se puede cambiar despues.'}
        </p>
        {!slugBloqueado && !slugOk && slug !== '' ? (
          <p role="alert" className="text-xs text-destructive">
            Solo minusculas, numeros y guiones (ej: lomitos-del-barrio).
          </p>
        ) : null}
      </div>
    </>
  );
}

function CampoWhatsApp({
  whatsapp,
  setWhatsapp,
}: {
  whatsapp: string;
  setWhatsapp: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="local-wa">WhatsApp del local (opcional)</Label>
      <Input
        id="local-wa"
        value={whatsapp}
        onChange={(e) => setWhatsapp(e.target.value.slice(0, 40))}
        inputMode="tel"
        placeholder="+54911..."
      />
      <p className="text-xs text-muted-foreground">
        Donde el cliente escribe para canjear el premio. Formato internacional.
      </p>
    </div>
  );
}

function CampoPlanYColores({
  plan,
  setPlan,
  colorPrimario,
  setColorPrimario,
  colorSecundario,
  setColorSecundario,
}: {
  plan: PlanLocal;
  setPlan: (v: PlanLocal) => void;
  colorPrimario: string;
  setColorPrimario: (v: string) => void;
  colorSecundario: string;
  setColorSecundario: (v: string) => void;
}) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="local-plan">Plan</Label>
        <Select value={plan} onValueChange={(v) => setPlan(v as PlanLocal)}>
          <SelectTrigger id="local-plan">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PLANES.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Con FREE la carta y el club funcionan igual; el plan cambia limites y features.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <CampoColor
          id="local-color-primario"
          etiqueta="Color primario"
          valor={colorPrimario}
          onChange={setColorPrimario}
        />
        <CampoColor
          id="local-color-secundario"
          etiqueta="Color secundario"
          valor={colorSecundario}
          onChange={setColorSecundario}
        />
      </div>
    </>
  );
}

/** Hex + selector visual nativo: el hex manda, el selector es para elegir rapido. */
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
  const hexValido = /^#[0-9a-fA-F]{6}$/.test(valor);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{etiqueta}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${etiqueta} (selector)`}
          value={hexValido ? valor : '#000000'}
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
          placeholder="#E11D48"
        />
      </div>
      {!hexValido ? (
        <p role="alert" className="text-xs text-destructive">
          {valor === ''
            ? 'El color no puede quedar vacio: elegi un hex de 6 digitos (ej: #E11D48).'
            : 'El color va en hex de 6 digitos (ej: #E11D48).'}
        </p>
      ) : null}
    </div>
  );
}

export function ErrorForm({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
      {error}
    </p>
  );
}
