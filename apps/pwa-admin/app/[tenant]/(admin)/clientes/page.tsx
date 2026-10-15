'use client';

import * as React from 'react';
import {
  Badge,
  BottomSheet,
  Button,
  DataTable,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  toast,
} from '@repo/ui';
import type { DataTableColumn } from '@repo/ui';
import { clientesApi, configuracionApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';
import type { ClienteResumen, EtiquetaCliente, GeneroCliente } from '@/types/api';

const PAGE_SIZE = 20;

/** Etiquetas del enum, en el orden en que el dueno las lee. */
const ETIQUETAS: EtiquetaCliente[] = ['NUEVO', 'REGULAR', 'VIP', 'INACTIVO'];

/** Los literales del enum `GeneroCliente` del schema: la UI NUNCA inventa uno. */
const GENEROS: { valor: GeneroCliente; etiqueta: string }[] = [
  { valor: 'FEMENINO', etiqueta: 'Femenino' },
  { valor: 'MASCULINO', etiqueta: 'Masculino' },
  { valor: 'NO_BINARIO', etiqueta: 'No binario' },
  { valor: 'OTRO', etiqueta: 'Otro' },
  { valor: 'PREFIERO_NO_DECIR', etiqueta: 'Prefiero no decir' },
];

/** Valor del `<Select>` que representa "sin dato" (el backend guarda `null`, no un literal). */
const SIN_DATO = 'sin-dato';

/** Los dos campos del perfilado: los comparten el alta y la edicion. */
type CamposPerfil = {
  fechaNacimiento?: string | null | undefined;
  genero?: GeneroCliente | null | undefined;
};

const tieneFecha = (c: ClienteResumen): boolean =>
  typeof c.fechaNacimiento === 'string' && c.fechaNacimiento !== '';
const tieneGenero = (c: ClienteResumen): boolean => c.genero != null;

/** El `type="date"` necesita `YYYY-MM-DD`: el ISO que llega trae hora y zona. */
function paraInputDate(iso: string | null | undefined): string {
  if (typeof iso !== 'string' || iso === '') return '';
  return iso.slice(0, 10);
}

/**
 * Clientes del club.
 *
 * Es la pantalla que le dice al dueno A QUIEN le falta el dato: la lista muestra, por cliente, si
 * tiene la fecha de nacimiento y el genero cargados (los dos campos del perfilado progresivo que se
 * piden a partir de la visita N). El detalle/edicion va en un `BottomSheet` porque el admin es una
 * PWA mobile y los formularios largos no entran en un `Dialog` centrado.
 *
 * Tres cosas que la pantalla NO puede asumir, verificadas contra el backend:
 * 1. `GET /clientes` devuelve MAS campos cuando lo consulta un privilegiado (DUENO/ENCARGADO):
 *    `fechaNacimiento`, `notasInternas` y `email` no viajan en la vista del staff. Todos los campos
 *    de `ClienteResumen` (salvo `id`/`nombre`) son opcionales y se tratan como "sin dato".
 * 2. El `telefono` NO esta en `ActualizarClienteDto`: es la clave del cliente dentro del negocio y
 *    desde aca se puede cargar (alta) pero no cambiar. En edicion se muestra de solo lectura.
 * 3. `POST /clientes` es un UPSERT encubierto: si el telefono ya existe y esta dado de baja, el
 *    backend LO REVIVE (no crea un duplicado ni consume cupo). El mensaje del alta lo dice.
 *
 * `fechaNacimiento` / `genero` los agrega el backend en la MISMA fase que esta pantalla. Como el
 * `ValidationPipe` del backend corre con `forbidNonWhitelisted`, mandar un campo que su DTO todavia
 * no conoce responde 400 y haria fallar el guardado ENTERO. Por eso la pantalla detecta si ese
 * deploy ya llego (`perfilDesdeVisita` viaja en la config desde la misma version) y, mientras no
 * este, oculta esos dos campos del guardado y lo avisa en pantalla.
 */
export default function ClientesPage() {
  const [clientes, setClientes] = React.useState<ClienteResumen[] | null>(null);
  const [total, setTotal] = React.useState(0);
  const [pagina, setPagina] = React.useState(1);
  const [busqueda, setBusqueda] = React.useState('');
  /** Termino EFECTIVO (con el debounce ya aplicado): es el que va a la API. */
  const [q, setQ] = React.useState('');
  const [filtroEtiqueta, setFiltroEtiqueta] = React.useState('todas');
  const [error, setError] = React.useState<string | null>(null);
  const [enEdicion, setEnEdicion] = React.useState<ClienteResumen | null>(null);
  const [creando, setCreando] = React.useState(false);
  /** Se incrementa tras guardar para volver a pedir la lista (y mostrar el dato nuevo). */
  const [version, setVersion] = React.useState(0);
  /**
   * `true` / `false` = el backend de esta fase ya deployo (o no); `null` = todavia no sabemos
   * (la config no cargo). Con `null` se asume el contrato: es el estado normal en produccion.
   */
  const [perfilSoportado, setPerfilSoportado] = React.useState<boolean | null>(null);
  /** Umbral configurado (Configuracion -> Local), solo para el texto de ayuda. */
  const [umbral, setUmbral] = React.useState<number | null>(null);

  const refetch = React.useCallback(async () => {
    try {
      const r = await clientesApi.listar({
        page: pagina,
        pageSize: PAGE_SIZE,
        ...(q === '' ? {} : { search: q }),
        ...(filtroEtiqueta === 'todas' ? {} : { etiqueta: filtroEtiqueta }),
      });
      const data = Array.isArray(r.data) ? r.data : [];
      setClientes(data);
      setTotal(typeof r.total === 'number' ? r.total : data.length);
      setError(null);
    } catch (e) {
      const { status, mensaje } = normalizarError(e);
      // 401 lo maneja el layout (manda al login): no se grita en un toast.
      if (status !== 401) setError(mensaje);
      setClientes([]);
    }
  }, [pagina, q, filtroEtiqueta]);

  React.useEffect(() => {
    void refetch();
  }, [refetch, version]);

  /**
   * Capacidad del backend de esta fase. El GET de configuracion devuelve `perfilDesdeVisita` desde
   * la misma version que acepta `fechaNacimiento`/`genero` en los clientes: alcanza con un GET para
   * saber si podemos guardarlos. Si el GET falla queda `null` (desconocido) y se manda igual.
   */
  React.useEffect(() => {
    let cancelado = false;
    configuracionApi
      .obtener()
      .then((cfg) => {
        if (cancelado) return;
        const valor = typeof cfg.perfilDesdeVisita === 'number' ? cfg.perfilDesdeVisita : null;
        setUmbral(valor);
        setPerfilSoportado(valor !== null);
      })
      .catch(() => {
        if (!cancelado) setPerfilSoportado(null);
      });
    return () => {
      cancelado = true;
    };
  }, []);

  // Debounce del buscador: la API ya busca por nombre y telefono del lado del servidor.
  React.useEffect(() => {
    const termino = busqueda.trim();
    const t = window.setTimeout(() => setQ(termino), termino === '' ? 0 : 300);
    return () => window.clearTimeout(t);
  }, [busqueda]);

  // Cualquier cambio de filtro vuelve a la pagina 1: quedarse en la 3 de un resultado nuevo da
  // una lista vacia que parece un bug.
  React.useEffect(() => {
    setPagina(1);
  }, [q, filtroEtiqueta]);

  React.useEffect(() => {
    if (error) toast.error('No pudimos traer los clientes', { description: error });
  }, [error]);

  const lista = React.useMemo(() => clientes ?? [], [clientes]);
  const paginas = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const desde = total === 0 ? 0 : (pagina - 1) * PAGE_SIZE + 1;
  const hasta = Math.min(pagina * PAGE_SIZE, total);

  // Todos los hooks ARRIBA del primer return (React #310).
  const columnas: DataTableColumn<ClienteResumen>[] = React.useMemo(
    () => [
      {
        key: 'cliente',
        header: 'Cliente',
        render: (c) => (
          <div className="min-w-0">
            <p className="truncate font-medium">{c.nombre}</p>
            {c.telefono ? (
              <p className="truncate text-xs tabular-nums text-muted-foreground">{c.telefono}</p>
            ) : null}
          </div>
        ),
      },
      {
        key: 'visitas',
        header: 'Visitas',
        className: 'whitespace-nowrap tabular-nums',
        render: (c) => <span className="tabular-nums">{c.totalVisitas ?? '—'}</span>,
      },
      {
        key: 'ultimaVisita',
        header: 'Ultima visita',
        className: 'whitespace-nowrap',
        render: (c) => <FechaDia valor={c.ultimaVisita} />,
      },
      {
        key: 'etiqueta',
        header: 'Etiqueta',
        className: 'whitespace-nowrap',
        render: (c) => <BadgeEtiqueta etiqueta={c.etiqueta} />,
      },
      {
        key: 'perfil',
        header: 'Perfil',
        className: 'whitespace-nowrap',
        render: (c) => (
          <div className="flex items-center gap-3">
            <PuntoDato cargado={tieneFecha(c)} etiqueta="Cumpleanos" />
            <PuntoDato cargado={tieneGenero(c)} etiqueta="Genero" />
          </div>
        ),
      },
      {
        key: 'saldo',
        header: 'Saldo',
        className: 'whitespace-nowrap',
        render: (c) => <Saldo sellos={c.sellosActuales} puntos={c.puntosActuales} />,
      },
    ],
    [],
  );

  const cerrando = React.useCallback(() => {
    setCreando(false);
    setEnEdicion(null);
  }, []);

  const onTerminar = React.useCallback(async () => {
    cerrando();
    await refetch();
    setVersion((v) => v + 1);
  }, [cerrando, refetch]);

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Clientes</h1>
          <p className="text-sm text-muted-foreground">
            {clientes === null && !error
              ? 'Cargando...'
              : `${total.toLocaleString('es-AR')} ${total === 1 ? 'cliente' : 'clientes'} en el club`}
          </p>
        </div>
        <Button onClick={() => setCreando(true)}>+ Nuevo cliente</Button>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={busqueda}
          // 80 = el `@MaxLength(80)` de `FiltrarClientesDto`: mas largo responde 400.
          onChange={(e) => setBusqueda(e.target.value.slice(0, 80))}
          placeholder="Buscar por nombre o telefono"
          autoCapitalize="none"
          aria-label="Buscar clientes por nombre o telefono"
          className="max-w-xs"
        />
        <Select value={filtroEtiqueta} onValueChange={setFiltroEtiqueta}>
          <SelectTrigger className="w-44" aria-label="Filtrar por etiqueta">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas las etiquetas</SelectItem>
            {ETIQUETAS.map((e) => (
              <SelectItem key={e} value={e}>
                {e}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        data={lista}
        columns={columnas}
        loading={clientes === null && !error}
        rowKey={(c) => c.id}
        onRowClick={(c) => setEnEdicion(c)}
        empty={
          q !== '' || filtroEtiqueta !== 'todas'
            ? 'No hay clientes que coincidan con la busqueda.'
            : 'Todavia no hay clientes en el club. Carga el primero con "+ Nuevo cliente".'
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs tabular-nums text-muted-foreground">
          {clientes === null && !error
            ? '\u00a0'
            : total === 0
              ? 'Sin resultados'
              : `${desde}-${hasta} de ${total.toLocaleString('es-AR')}`}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPagina((p) => Math.max(1, p - 1))}
            disabled={pagina <= 1 || clientes === null}
          >
            Anterior
          </Button>
          <span className="text-xs tabular-nums text-muted-foreground">
            {pagina} / {paginas}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPagina((p) => Math.min(paginas, p + 1))}
            disabled={pagina >= paginas || clientes === null}
          >
            Siguiente
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Toca un cliente para ver y editar sus datos. El <strong>perfil</strong> muestra si tiene
        cargados el cumpleanos y el genero:
      </p>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <PuntoDato cargado etiqueta="Cumpleanos" />
        <PuntoDato cargado etiqueta="Genero" />
        <span className="text-muted-foreground/80">
          (en gris = falta el dato).{' '}
          {umbral !== null
            ? `Se los pedimos al cliente a partir de la visita ${umbral}.`
            : 'El umbral se configura en Configuracion, pestana Local.'}
        </span>
      </p>

      <BottomSheet
        abierto={creando || enEdicion !== null}
        onCerrar={cerrando}
        titulo={enEdicion ? 'Editar cliente' : 'Nuevo cliente'}
        // `mx-auto` + `max-w`: en pantalla grande el sheet no se estira de punta a punta.
        className="sm:mx-auto sm:max-w-2xl"
      >
        {/* `key` que cambia con el cliente: el form se re-siembra solo, sin sincronizar a mano. */}
        <FormularioCliente
          key={enEdicion?.id ?? 'nuevo'}
          cliente={enEdicion}
          perfilSoportado={perfilSoportado}
          onTerminar={onTerminar}
          onCancelar={cerrando}
        />
      </BottomSheet>
    </section>
  );
}

/**
 * Badge de etiqueta. Reusa el patron que ya existe en el repo (`Badge variant="outline"` con el
 * literal crudo del enum, en `pwa-staff/components/PantallaValidar.tsx`), con las variantes que ya
 * trae `@repo/ui` para distinguir el VIP de un vistazo.
 */
function BadgeEtiqueta({ etiqueta }: { etiqueta: EtiquetaCliente | undefined }) {
  if (!etiqueta) return <span className="text-sm text-muted-foreground">—</span>;
  const variante =
    etiqueta === 'VIP'
      ? 'warning'
      : etiqueta === 'NUEVO'
        ? 'nuevo'
        : etiqueta === 'REGULAR'
          ? 'secondary'
          : 'outline';
  return (
    <Badge variant={variante} className="whitespace-nowrap">
      {etiqueta}
    </Badge>
  );
}

/**
 * Punto de "dato cargado / falta": el estado va en texto para lectores de pantalla.
 *
 * OJO con la implementacion: NO se usa `sr-only` aca. `sr-only` es `position:absolute` sin
 * `top/left`, asi que el span queda en su posicion ESTATICA — adentro de una celda de la tabla,
 * a ~619px en un viewport de 375px — y Chromium lo cuenta en el `scrollWidth` de `<html>`:
 * `scrollWidth - clientWidth = 244` en una pantalla que no desborda nada. El estado accesible
 * viaja por `aria-label` + `role="img"` (el patron de un indicador visual), no por un nodo oculto.
 */
function PuntoDato({ cargado, etiqueta }: { cargado: boolean; etiqueta: string }) {
  const estado = cargado ? 'cargado' : 'falta';
  return (
    <span
      role="img"
      title={`${etiqueta}: ${estado}`}
      aria-label={`${etiqueta}: ${estado}`}
      className={
        cargado
          ? 'inline-flex items-center gap-1.5 text-emerald-700'
          : 'inline-flex items-center gap-1.5 text-muted-foreground'
      }
    >
      <span
        aria-hidden="true"
        className={
          cargado
            ? 'h-2 w-2 shrink-0 rounded-full bg-emerald-500'
            : 'h-2 w-2 shrink-0 rounded-full border border-muted-foreground/50'
        }
      />
      <span className="text-xs">{etiqueta}</span>
    </span>
  );
}

/** Fecha sin hora (la ultima visita, en la lista). */
function FechaDia({ valor }: { valor: string | null | undefined }) {
  if (!valor) return <span className="text-sm text-muted-foreground">Nunca</span>;
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return <span className="text-sm text-muted-foreground">—</span>;
  return <span className="text-sm tabular-nums">{d.toLocaleDateString('es-AR')}</span>;
}

/** Sellos y puntos. Si la API no los manda (vista reducida), no se inventa un cero. */
function Saldo({ sellos, puntos }: { sellos?: number | undefined; puntos?: number | undefined }) {
  const partes: string[] = [];
  if (typeof sellos === 'number') partes.push(`${sellos} sellos`);
  if (typeof puntos === 'number') partes.push(`${puntos} pts`);
  if (partes.length === 0) return <span className="text-sm text-muted-foreground">—</span>;
  return <span className="text-sm tabular-nums">{partes.join(' · ')}</span>;
}

/**
 * Alta y edicion comparten formulario: `cliente` null = alta.
 *
 * El `telefono` solo se carga en el alta (en el PATCH el DTO no lo acepta y el backend lo usa como
 * identidad del cliente dentro del negocio).
 */
function FormularioCliente({
  cliente,
  perfilSoportado,
  onTerminar,
  onCancelar,
}: {
  cliente: ClienteResumen | null;
  perfilSoportado: boolean | null;
  onTerminar: () => void | Promise<void>;
  onCancelar: () => void;
}) {
  const [nombre, setNombre] = React.useState(cliente?.nombre ?? '');
  const [telefono, setTelefono] = React.useState(cliente?.telefono ?? '');
  const [email, setEmail] = React.useState(cliente?.email ?? '');
  const [fecha, setFecha] = React.useState(() => paraInputDate(cliente?.fechaNacimiento));
  const [genero, setGenero] = React.useState<GeneroCliente | typeof SIN_DATO>(
    cliente?.genero ?? SIN_DATO,
  );
  const [etiqueta, setEtiqueta] = React.useState<EtiquetaCliente | ''>(cliente?.etiqueta ?? '');
  const [acepta, setAcepta] = React.useState(cliente?.aceptaNotificaciones ?? false);
  const [notas, setNotas] = React.useState(cliente?.notasInternas ?? '');
  const [guardando, setGuardando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const esAlta = cliente === null;
  const conPerfil = perfilSoportado !== false;
  const nombreValido = nombre.trim().length >= 2;
  const puedeGuardar = nombreValido && (!esAlta || telefono.trim().length >= 6) && !guardando;

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!puedeGuardar) return;
    setGuardando(true);
    setError(null);
    // `null` = BORRAR el dato. Un campo que no se manda no se toca.
    const perfil: CamposPerfil = conPerfil
      ? { fechaNacimiento: fecha === '' ? null : fecha, genero: genero === SIN_DATO ? null : genero }
      : {};
    try {
      if (cliente) {
        await clientesApi.actualizar(cliente.id, {
          nombre: nombre.trim(),
          email: email.trim() === '' ? undefined : email.trim(),
          ...(etiqueta === '' ? {} : { etiqueta }),
          aceptaNotificaciones: acepta,
          notasInternas: notas.trim(),
          ...perfil,
        });
        toast.success(`${nombre.trim()} quedo actualizado`);
      } else {
        await clientesApi.crear({
          nombre: nombre.trim(),
          telefono: telefono.trim(),
          email: email.trim() === '' ? undefined : email.trim(),
          aceptaNotificaciones: acepta,
          notasInternas: notas.trim(),
          ...perfil,
        });
        // El backend es un UPSERT por telefono: si ya existia y estaba dado de baja, lo revive.
        toast.success(`${nombre.trim()} quedo en el club`, {
          description: 'Si ese telefono ya estaba cargado, se actualizo en vez de duplicarlo.',
        });
      }
      await onTerminar();
    } catch (e) {
      setError(normalizarError(e).mensaje);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-4 pb-2">
      <div className="space-y-2">
        <Label htmlFor="c-nombre">Nombre</Label>
        <Input
          id="c-nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value.slice(0, 120))}
          placeholder="Juan Perez"
          required
        />
        {!nombreValido && nombre !== '' ? (
          <p role="alert" className="text-xs text-destructive">
            El nombre necesita al menos 2 caracteres.
          </p>
        ) : null}
      </div>

      {esAlta ? (
        <div className="space-y-2">
          <Label htmlFor="c-telefono">Telefono</Label>
          <Input
            id="c-telefono"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value.slice(0, 40))}
            inputMode="tel"
            autoCapitalize="none"
            placeholder="+5491155558888"
            required
          />
          <p className="text-xs text-muted-foreground">
            Es la identidad del cliente en el club: con el mismo telefono no se duplica, se
            actualiza.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="c-telefono-ro">Telefono</Label>
          <Input id="c-telefono-ro" value={telefono} readOnly disabled className="tabular-nums" />
          <p className="text-xs text-muted-foreground">
            El telefono no se cambia desde aca: es con lo que el cliente entra al club.
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="c-fecha">Fecha de nacimiento</Label>
          <Input
            id="c-fecha"
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            disabled={!conPerfil}
          />
          {fecha !== '' ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setFecha('')}>
              Borrar la fecha
            </Button>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="c-genero">Genero</Label>
          <Select
            value={genero}
            onValueChange={(v) => setGenero(v === SIN_DATO ? SIN_DATO : (v as GeneroCliente))}
            disabled={!conPerfil}
          >
            <SelectTrigger id="c-genero">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SIN_DATO}>Sin dato</SelectItem>
              {GENEROS.map((g) => (
                <SelectItem key={g.valor} value={g.valor}>
                  {g.etiqueta}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Con estos dos datos el local le puede mandar el saludo de cumpleanos. Son opcionales: el
        cliente los carga solo cuando se los pedimos (a partir de la visita configurada).
      </p>

      {!conPerfil ? (
        <p
          role="status"
          className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          La fecha de nacimiento y el genero todavia no se guardan: falta la actualizacion del
          servidor. El resto de los datos si.
        </p>
      ) : null}

      {cliente ? (
        <div className="space-y-2">
          <Label htmlFor="c-etiqueta">Etiqueta</Label>
          <Select
            value={etiqueta === '' ? SIN_DATO : etiqueta}
            onValueChange={(v) => setEtiqueta(v === SIN_DATO ? '' : (v as EtiquetaCliente))}
          >
            <SelectTrigger id="c-etiqueta" className="sm:max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SIN_DATO}>Dejar la que calcula el sistema</SelectItem>
              {ETIQUETAS.map((e) => (
                <SelectItem key={e} value={e}>
                  {e}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            El sistema la recalcula con las visitas; aca se puede fijar a mano.
          </p>
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="c-acepta">Acepta notificaciones</Label>
          <p className="text-xs text-muted-foreground">
            Si esta apagado, no le llegan los push (ni el de cumpleanos).
          </p>
        </div>
        <Switch id="c-acepta" checked={acepta} onCheckedChange={setAcepta} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="c-notas">Notas internas (opcional)</Label>
        <Textarea
          id="c-notas"
          value={notas}
          onChange={(e) => setNotas(e.target.value.slice(0, 500))}
          placeholder="Solo lo ve el local: ej. prefiere sin sal"
        />
        <p className="text-xs text-muted-foreground">El cliente nunca las ve.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="c-email">Email (opcional)</Label>
        <Input
          id="c-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value.slice(0, 120))}
          autoCapitalize="none"
          spellCheck={false}
        />
      </div>

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!puedeGuardar}>
          {guardando ? 'Guardando...' : esAlta ? 'Crear cliente' : 'Guardar cambios'}
        </Button>
      </div>
    </form>
  );
}
