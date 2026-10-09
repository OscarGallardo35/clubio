'use client';

import * as React from 'react';
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
  BottomSheet,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
  toast,
} from '@repo/ui';
import { clientesApi, disparosApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';
import { renderizarPlantilla } from '@/lib/push';
import type {
  ClienteResumen,
  ConfigDisparo,
  CrearDisparoBody,
  DatosEjemploPlantilla,
  DisparoPush,
  EstadoPedidoDisparo,
  LimitePorCliente,
  PlantillaPush,
  RegaloDisparo,
  TipoDisparo,
} from '@/types/api';

/**
 * Disparos de push (pestana "Disparos" dentro de Notificaciones).
 *
 * Un disparo manda una plantilla cuando pasa algo: se entrega un pedido (COMPRA), el
 * cliente suma un sello o le faltan N (SELLOS), llega un dia/hora (DIA), lleva N dias
 * sin volver (INACTIVIDAD), se registra (BIENVENIDA) o a mano (MANUAL).
 *
 * Dos cosas que la UI no esconde:
 * - Si el disparo tiene `regalo`, ACREDITA SELLOS/PUNTOS REALES al cliente (no es decorativo).
 * - `limitePorCliente` acota cuanto puede regalar a UN cliente (por dia / por mes).
 *
 * Todo vive detras de `@RequiereFeature('push')`: si el plan no la incluye el backend
 * responde 403 y el toast lo muestra.
 */

const TIPOS: { valor: TipoDisparo; etiqueta: string; ayuda: string }[] = [
  { valor: 'COMPRA', etiqueta: 'Por compra', ayuda: 'Cuando un pedido llega a cierto estado (y cada cuantas compras).' },
  { valor: 'SELLOS', etiqueta: 'Por sellos', ayuda: 'Cuando suma un sello, o cuando le faltan N para el premio.' },
  { valor: 'DIA', etiqueta: 'Por dia', ayuda: 'Un dia de la semana a una hora, o una fecha puntual.' },
  { valor: 'INACTIVIDAD', etiqueta: 'Por inactividad', ayuda: 'Cuando el cliente no vuelve hace N dias.' },
  { valor: 'BIENVENIDA', etiqueta: 'Bienvenida', ayuda: 'Cuando el cliente se registra.' },
  { valor: 'MANUAL', etiqueta: 'Manual', ayuda: 'No se dispara solo: se manda a mano (por ejemplo desde "Probar").' },
];

const ETIQUETA_TIPO: Record<TipoDisparo, string> = {
  COMPRA: 'Compra',
  SELLOS: 'Sellos',
  DIA: 'Dia',
  INACTIVIDAD: 'Inactividad',
  BIENVENIDA: 'Bienvenida',
  MANUAL: 'Manual',
};

const ESTADOS: { valor: EstadoPedidoDisparo; etiqueta: string }[] = [
  { valor: 'ENTREGADO', etiqueta: 'Entregado' },
  { valor: 'LISTO', etiqueta: 'Listo' },
  { valor: 'ENVIADO', etiqueta: 'Enviado' },
  { valor: 'EN_PREPARACION', etiqueta: 'En preparacion' },
  { valor: 'CONFIRMADO', etiqueta: 'Confirmado' },
  { valor: 'PENDIENTE', etiqueta: 'Pendiente' },
  { valor: 'CANCELADO', etiqueta: 'Cancelado' },
  { valor: 'RECHAZADO', etiqueta: 'Rechazado' },
];

const DIAS: { valor: string; etiqueta: string }[] = [
  { valor: 'MONDAY', etiqueta: 'Lunes' },
  { valor: 'TUESDAY', etiqueta: 'Martes' },
  { valor: 'WEDNESDAY', etiqueta: 'Miercoles' },
  { valor: 'THURSDAY', etiqueta: 'Jueves' },
  { valor: 'FRIDAY', etiqueta: 'Viernes' },
  { valor: 'SATURDAY', etiqueta: 'Sabado' },
  { valor: 'SUNDAY', etiqueta: 'Domingo' },
];

function etiquetaEstado(valor: string): string {
  return ESTADOS.find((e) => e.valor === valor)?.etiqueta ?? valor;
}

function nombreDia(valor: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor;
  return DIAS.find((d) => d.valor === valor)?.etiqueta ?? valor;
}

/** Lee un campo de `config` sin asumir el tipo (el backend lo guarda por tipo de disparo). */
function leerConfig(config: ConfigDisparo | null | undefined, campo: string): unknown {
  if (!config || typeof config !== 'object') return undefined;
  return (config as Record<string, unknown>)[campo];
}

function numeroDe(valor: unknown, porDefecto: number): number {
  const n = typeof valor === 'number' ? valor : Number(valor);
  return Number.isFinite(n) ? n : porDefecto;
}

/** Texto legible de la configuracion, para la lista. */
function descripcionConfig(d: DisparoPush): string {
  switch (d.tipo) {
    case 'COMPRA': {
      const n = numeroDe(leerConfig(d.config, 'cadaNCompras'), 1);
      const estado = etiquetaEstado(String(leerConfig(d.config, 'estado') ?? 'ENTREGADO'));
      return n > 1 ? `Cada ${n} compras (${estado})` : `Cuando el pedido queda ${estado}`;
    }
    case 'SELLOS': {
      const cuando = String(leerConfig(d.config, 'cuando') ?? 'CADA_SELLO');
      if (cuando === 'FALTAN_N') {
        return `Cuando le faltan ${numeroDe(leerConfig(d.config, 'n'), 1)} sellos para el premio`;
      }
      return 'Cada sello que suma';
    }
    case 'DIA': {
      const dia = nombreDia(String(leerConfig(d.config, 'dia') ?? ''));
      const hora = String(leerConfig(d.config, 'hora') ?? '');
      return `${dia} ${hora}`.trim();
    }
    case 'INACTIVIDAD':
      return `Despues de ${numeroDe(leerConfig(d.config, 'dias'), 30)} dias sin volver`;
    case 'BIENVENIDA':
      return 'Al registrarse';
    case 'MANUAL':
      return 'Solo a mano';
  }
}

/** "+1 sello", "+10 puntos", "+1 sello · +10 puntos" o null si no regala nada. */
function etiquetaRegalo(regalo: RegaloDisparo | null): string | null {
  if (!regalo) return null;
  const partes: string[] = [];
  if (regalo.sellos) partes.push(`+${regalo.sellos} ${regalo.sellos === 1 ? 'sello' : 'sellos'}`);
  if (regalo.puntos) partes.push(`+${regalo.puntos} ${regalo.puntos === 1 ? 'punto' : 'puntos'}`);
  return partes.length > 0 ? partes.join(' · ') : null;
}

function etiquetaLimite(limite: LimitePorCliente | null): string | null {
  if (!limite) return null;
  const partes: string[] = [];
  if (limite.porDia) partes.push(`${limite.porDia}/dia`);
  if (limite.porMes) partes.push(`${limite.porMes}/mes`);
  return partes.length > 0 ? `Tope por cliente: ${partes.join(' · ')}` : null;
}

export function Disparos({
  plantillas,
  ejemplo,
}: {
  plantillas: PlantillaPush[] | null;
  ejemplo: DatosEjemploPlantilla | null;
}) {
  const [disparos, setDisparos] = React.useState<DisparoPush[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [creando, setCreando] = React.useState(false);
  const [editando, setEditando] = React.useState<DisparoPush | null>(null);
  const [probando, setProbando] = React.useState<DisparoPush | null>(null);
  const [aEliminar, setAEliminar] = React.useState<DisparoPush | null>(null);
  const [borrando, setBorrando] = React.useState(false);

  const listaPlantillas = React.useMemo(() => plantillas ?? [], [plantillas]);

  const refetch = React.useCallback(async () => {
    try {
      const r = await disparosApi.listar();
      setDisparos(Array.isArray(r) ? r : []);
      setError(null);
    } catch (e) {
      const { status, mensaje } = normalizarError(e);
      if (status !== 401) setError(mensaje);
    }
  }, []);

  React.useEffect(() => {
    void refetch();
  }, [refetch]);

  React.useEffect(() => {
    if (error) toast.error('No pudimos traer los disparos', { description: error });
  }, [error]);

  /** Toggle optimista con rollback: si el PATCH falla, el switch vuelve solo. */
  const alternar = React.useCallback(async (d: DisparoPush, activa: boolean) => {
    setDisparos((prev) => (prev ? prev.map((x) => (x.id === d.id ? { ...x, activa } : x)) : prev));
    try {
      await disparosApi.actualizar(d.id, { activa });
    } catch (e) {
      setDisparos((prev) => (prev ? prev.map((x) => (x.id === d.id ? { ...x, activa: d.activa } : x)) : prev));
      toast.error(`No se pudo cambiar ${d.nombre}. ${normalizarError(e).mensaje}`);
    }
  }, []);

  const confirmarEliminar = React.useCallback(async () => {
    if (!aEliminar) return;
    setBorrando(true);
    try {
      await disparosApi.eliminar(aEliminar.id);
      toast.success(`Se elimino ${aEliminar.nombre}`);
      setAEliminar(null);
      await refetch();
    } catch (e) {
      toast.error(`No se pudo eliminar ${aEliminar.nombre}. ${normalizarError(e).mensaje}`);
    } finally {
      setBorrando(false);
    }
  }, [aEliminar, refetch]);

  const activos = (disparos ?? []).filter((d) => d.activa).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {disparos === null
            ? 'Cargando...'
            : `${activos} de ${disparos.length} disparos activos`}
        </p>
        <Button onClick={() => setCreando(true)} disabled={listaPlantillas.length === 0}>
          + Nuevo disparo
        </Button>
      </div>

      {listaPlantillas.length === 0 ? (
        <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Un disparo necesita una plantilla. Crea primero una en la pestana &quot;Plantillas&quot;.
        </p>
      ) : null}

      {disparos === null && !error ? <Skeleton className="h-40 w-full" /> : null}

      {disparos && disparos.length === 0 ? (
        <p className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
          Todavia no hay disparos. Crea el primero con &quot;+ Nuevo disparo&quot;.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {disparos?.map((d) => {
          const planta = listaPlantillas.find((p) => p.id === d.plantillaId);
          const regalo = etiquetaRegalo(d.regalo);
          const limite = etiquetaLimite(d.limitePorCliente);
          return (
            <article key={d.id} className="space-y-3 rounded-2xl border bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-base font-semibold">{d.nombre}</h2>
                    <Badge variant="outline" className="shrink-0">
                      {ETIQUETA_TIPO[d.tipo]}
                    </Badge>
                    {d.activa ? (
                      <Badge variant="secondary" className="shrink-0">
                        activo
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="shrink-0 text-muted-foreground">
                        pausado
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{descripcionConfig(d)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Switch
                    checked={d.activa}
                    onCheckedChange={(v) => void alternar(d, v)}
                    aria-label={`Activo: ${d.nombre}`}
                  />
                </div>
              </div>

              <ul className="space-y-1 text-xs text-muted-foreground">
                <li>
                  Plantilla:{' '}
                  <span className="text-foreground">{planta?.nombre ?? 'plantilla eliminada'}</span>
                </li>
                {regalo ? (
                  <li className="text-emerald-700">Regalo: {regalo} (acredita saldo real)</li>
                ) : (
                  <li>Sin regalo</li>
                )}
                {limite ? <li>{limite}</li> : null}
              </ul>

              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditando(d)}>
                  Editar
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setProbando(d)}>
                  Probar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive"
                  onClick={() => setAEliminar(d)}
                >
                  Eliminar
                </Button>
              </div>
            </article>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Un disparo con <strong>regalo</strong> acredita sellos o puntos de verdad al cliente. Los
        topes son <strong>por cliente</strong>, para que no acumule de mas.
      </p>

      <BottomSheet
        abierto={creando || editando !== null}
        onCerrar={() => {
          setCreando(false);
          setEditando(null);
        }}
        titulo={editando ? 'Editar disparo' : 'Nuevo disparo'}
        altura="completa"
      >
        {/* `key`: al abrir otro disparo el formulario se remonta con valores frescos. */}
        <FormularioDisparo
          key={editando?.id ?? 'nuevo'}
          disparo={editando}
          plantillas={listaPlantillas}
          ejemplo={ejemplo}
          onTerminar={async () => {
            setCreando(false);
            setEditando(null);
            await refetch();
          }}
          onCancelar={() => {
            setCreando(false);
            setEditando(null);
          }}
        />
      </BottomSheet>

      <BottomSheet
        abierto={probando !== null}
        onCerrar={() => setProbando(null)}
        titulo={probando ? `Probar: ${probando.nombre}` : 'Probar'}
        altura="media"
      >
        {probando ? <ProbarDisparo disparo={probando} onCerrar={() => setProbando(null)} /> : null}
      </BottomSheet>

      <AlertDialog
        open={aEliminar !== null}
        onOpenChange={(abierto) => {
          if (!abierto) setAEliminar(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar {aEliminar?.nombre}?</AlertDialogTitle>
            <AlertDialogDescription>
              El disparo deja de mandarse. Las notificaciones ya enviadas no se tocan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmarEliminar()}
              disabled={borrando}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {borrando ? 'Eliminando...' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Alta y edicion comparten formulario: `disparo` null = alta. */
function FormularioDisparo({
  disparo,
  plantillas,
  ejemplo,
  onTerminar,
  onCancelar,
}: {
  disparo: DisparoPush | null;
  plantillas: PlantillaPush[];
  ejemplo: DatosEjemploPlantilla | null;
  onTerminar: () => void | Promise<void>;
  onCancelar: () => void;
}) {
  const cfg = disparo?.config ?? null;
  const diaGuardado = String(leerConfig(cfg, 'dia') ?? 'FRIDAY');
  const diaEsFecha = /^\d{4}-\d{2}-\d{2}$/.test(diaGuardado);

  const [nombre, setNombre] = React.useState(disparo?.nombre ?? '');
  const [tipo, setTipo] = React.useState<TipoDisparo>(disparo?.tipo ?? 'COMPRA');
  const [activa, setActiva] = React.useState(disparo?.activa ?? true);
  const [plantillaId, setPlantillaId] = React.useState(
    disparo?.plantillaId ?? plantillas[0]?.id ?? '',
  );

  // COMPRA
  const [estadoCompra, setEstadoCompra] = React.useState<EstadoPedidoDisparo>(
    (leerConfig(cfg, 'estado') as EstadoPedidoDisparo) ?? 'ENTREGADO',
  );
  const [cadaN, setCadaN] = React.useState(String(numeroDe(leerConfig(cfg, 'cadaNCompras'), 1)));
  // SELLOS
  const [cuandoSellos, setCuandoSellos] = React.useState<'CADA_SELLO' | 'FALTAN_N'>(
    leerConfig(cfg, 'cuando') === 'FALTAN_N' ? 'FALTAN_N' : 'CADA_SELLO',
  );
  const [nSellos, setNSellos] = React.useState(String(numeroDe(leerConfig(cfg, 'n'), 3)));
  // DIA
  const [diaModo, setDiaModo] = React.useState<'semana' | 'fecha'>(diaEsFecha ? 'fecha' : 'semana');
  const [diaSemana, setDiaSemana] = React.useState(diaEsFecha ? 'FRIDAY' : diaGuardado);
  const [diaFecha, setDiaFecha] = React.useState(diaEsFecha ? diaGuardado : '');
  const [hora, setHora] = React.useState(String(leerConfig(cfg, 'hora') ?? '18:00'));
  // INACTIVIDAD
  const [dias, setDias] = React.useState(String(numeroDe(leerConfig(cfg, 'dias'), 30)));

  // Regalo opcional (acredita saldo real).
  const [sellosRegalo, setSellosRegalo] = React.useState(
    disparo?.regalo?.sellos != null ? String(disparo.regalo.sellos) : '',
  );
  const [puntosRegalo, setPuntosRegalo] = React.useState(
    disparo?.regalo?.puntos != null ? String(disparo.regalo.puntos) : '',
  );
  // Tope por cliente.
  const [porDia, setPorDia] = React.useState(
    disparo?.limitePorCliente?.porDia != null ? String(disparo.limitePorCliente.porDia) : '',
  );
  const [porMes, setPorMes] = React.useState(
    disparo?.limitePorCliente?.porMes != null ? String(disparo.limitePorCliente.porMes) : '',
  );

  const [guardando, setGuardando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const enteroPositivo = (s: string) => {
    const n = Number(s.replace(',', '.'));
    return s.trim() !== '' && Number.isInteger(n) && n >= 1;
  };
  const opcionalEnteroPositivo = (s: string) => s.trim() === '' || enteroPositivo(s);

  const nombreOk = nombre.trim().length >= 2;
  const plantillaOk = plantillaId !== '';
  const configOk =
    tipo === 'COMPRA'
      ? enteroPositivo(cadaN)
      : tipo === 'SELLOS'
        ? cuandoSellos === 'CADA_SELLO' || enteroPositivo(nSellos)
        : tipo === 'DIA'
          ? (diaModo === 'semana' ? diaSemana !== '' : diaFecha.trim() !== '') && hora.trim() !== ''
          : tipo === 'INACTIVIDAD'
            ? enteroPositivo(dias)
            : true;
  const extrasOk =
    opcionalEnteroPositivo(sellosRegalo) &&
    opcionalEnteroPositivo(puntosRegalo) &&
    opcionalEnteroPositivo(porDia) &&
    opcionalEnteroPositivo(porMes);
  const puedeGuardar = nombreOk && plantillaOk && configOk && extrasOk && !guardando;

  const plantillaElegida = plantillas.find((p) => p.id === plantillaId) ?? null;

  function construirConfig(): ConfigDisparo {
    switch (tipo) {
      case 'COMPRA':
        return { estado: estadoCompra, cadaNCompras: Number(cadaN) };
      case 'SELLOS':
        return cuandoSellos === 'FALTAN_N'
          ? { cuando: 'FALTAN_N', n: Number(nSellos) }
          : { cuando: 'CADA_SELLO' };
      case 'DIA':
        return { dia: diaModo === 'fecha' ? diaFecha : diaSemana, hora };
      case 'INACTIVIDAD':
        return { dias: Number(dias) };
      default:
        return {};
    }
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!puedeGuardar) return;
    setGuardando(true);
    setError(null);
    try {
      const regalo: RegaloDisparo = {};
      if (sellosRegalo.trim() !== '') regalo.sellos = Number(sellosRegalo);
      if (puntosRegalo.trim() !== '') regalo.puntos = Number(puntosRegalo);
      const limite: LimitePorCliente = {};
      if (porDia.trim() !== '') limite.porDia = Number(porDia);
      if (porMes.trim() !== '') limite.porMes = Number(porMes);

      const body: CrearDisparoBody = {
        nombre: nombre.trim(),
        tipo,
        activa,
        plantillaId,
        config: construirConfig(),
        ...(regalo.sellos !== undefined || regalo.puntos !== undefined ? { regalo } : {}),
        ...(limite.porDia !== undefined || limite.porMes !== undefined
          ? { limitePorCliente: limite }
          : {}),
      };
      if (disparo) await disparosApi.actualizar(disparo.id, body);
      else await disparosApi.crear(body);
      toast.success(disparo ? 'Disparo actualizado' : 'Disparo creado');
      await onTerminar();
    } catch (err) {
      setError(normalizarError(err).mensaje);
    } finally {
      setGuardando(false);
    }
  }

  const ayudaTipo = TIPOS.find((t) => t.valor === tipo)?.ayuda ?? '';

  return (
    <form onSubmit={guardar} className="space-y-5 pb-2">
      <div className="space-y-2">
        <Label htmlFor="d-nombre">Nombre interno</Label>
        <Input
          id="d-nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value.slice(0, 80))}
          placeholder="Gracias por tu compra"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="d-tipo">Cuando se dispara</Label>
        <Select value={tipo} onValueChange={(v) => setTipo(v as TipoDisparo)}>
          <SelectTrigger id="d-tipo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIPOS.map((t) => (
              <SelectItem key={t.valor} value={t.valor}>
                {t.etiqueta}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {ayudaTipo ? <p className="text-xs text-muted-foreground">{ayudaTipo}</p> : null}
      </div>

      {/* Config segun el tipo. */}
      {tipo === 'COMPRA' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="d-estado">Estado del pedido</Label>
            <Select
              value={estadoCompra}
              onValueChange={(v) => setEstadoCompra(v as EstadoPedidoDisparo)}
            >
              <SelectTrigger id="d-estado">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ESTADOS.map((s) => (
                  <SelectItem key={s.valor} value={s.valor}>
                    {s.etiqueta}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="d-cadan">Cada cuantas compras</Label>
            <Input
              id="d-cadan"
              value={cadaN}
              onChange={(e) => setCadaN(e.target.value.replace(/[^0-9]/g, ''))}
              inputMode="numeric"
            />
            <p className="text-xs text-muted-foreground">
              Con 1 se manda en cada compra; con 3, una de cada tres.
            </p>
          </div>
        </div>
      ) : null}

      {tipo === 'SELLOS' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="d-cuando">Momento</Label>
            <Select
              value={cuandoSellos}
              onValueChange={(v) => setCuandoSellos(v as 'CADA_SELLO' | 'FALTAN_N')}
            >
              <SelectTrigger id="d-cuando">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CADA_SELLO">Cada sello que suma</SelectItem>
                <SelectItem value="FALTAN_N">Cuando le faltan N para el premio</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {cuandoSellos === 'FALTAN_N' ? (
            <div className="space-y-2">
              <Label htmlFor="d-nsellos">Cuantos sellos le faltan</Label>
              <Input
                id="d-nsellos"
                value={nSellos}
                onChange={(e) => setNSellos(e.target.value.replace(/[^0-9]/g, ''))}
                inputMode="numeric"
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {tipo === 'DIA' ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="d-diamodo">Tipo de dia</Label>
            <Select value={diaModo} onValueChange={(v) => setDiaModo(v as 'semana' | 'fecha')}>
              <SelectTrigger id="d-diamodo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="semana">Dia de la semana</SelectItem>
                <SelectItem value="fecha">Fecha puntual</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {diaModo === 'semana' ? (
              <div className="space-y-2">
                <Label htmlFor="d-diasemana">Dia</Label>
                <Select value={diaSemana} onValueChange={setDiaSemana}>
                  <SelectTrigger id="d-diasemana">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DIAS.map((d) => (
                      <SelectItem key={d.valor} value={d.valor}>
                        {d.etiqueta}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="d-diafecha">Fecha</Label>
                <Input
                  id="d-diafecha"
                  type="date"
                  value={diaFecha}
                  onChange={(e) => setDiaFecha(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="d-hora">Hora</Label>
              <Input id="d-hora" type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
            </div>
          </div>
        </div>
      ) : null}

      {tipo === 'INACTIVIDAD' ? (
        <div className="space-y-2 sm:max-w-xs">
          <Label htmlFor="d-dias">Dias sin volver</Label>
          <Input
            id="d-dias"
            value={dias}
            onChange={(e) => setDias(e.target.value.replace(/[^0-9]/g, ''))}
            inputMode="numeric"
          />
          <p className="text-xs text-muted-foreground">
            Si el cliente no vuelve en estos dias, se le manda la plantilla.
          </p>
        </div>
      ) : null}

      {tipo === 'BIENVENIDA' || tipo === 'MANUAL' ? (
        <p className="rounded-xl border border-dashed bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          {tipo === 'BIENVENIDA'
            ? 'Se manda cuando el cliente se registra. No necesita configuracion.'
            : 'Este disparo no se manda solo: se usa a mano (por ejemplo desde "Probar").'}
        </p>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="d-plantilla">Plantilla</Label>
        <Select value={plantillaId} onValueChange={setPlantillaId}>
          <SelectTrigger id="d-plantilla">
            <SelectValue placeholder="Elegi una plantilla" />
          </SelectTrigger>
          <SelectContent>
            {plantillas.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!plantillaOk ? (
          <p role="alert" className="text-xs text-destructive">
            Elegi una plantilla para el mensaje.
          </p>
        ) : null}
      </div>

      {/* Preview con las variables ya reemplazadas por datos de un cliente real. */}
      <div className="rounded-xl border border-dashed bg-muted/40 p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Preview
        </p>
        {plantillaElegida ? (
          <>
            <p className="mt-1 text-sm font-medium">
              {renderizarPlantilla(plantillaElegida.titulo, ejemplo)}
            </p>
            <p className="text-sm text-muted-foreground">
              {renderizarPlantilla(plantillaElegida.cuerpo, ejemplo)}
            </p>
            {ejemplo ? (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Ejemplo con {ejemplo.nombre} ({ejemplo.actuales}/{ejemplo.meta} sellos)
              </p>
            ) : null}
          </>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">Elegi una plantilla para ver el mensaje.</p>
        )}
      </div>

      {/* Regalo opcional: acredita saldo real. */}
      <div className="space-y-3 rounded-xl border bg-card p-4">
        <div>
          <Label>Regalo (opcional)</Label>
          <p className="text-xs text-amber-700">
            Si completas sellos o puntos, el disparo <strong>acredita saldo real</strong> al cliente.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="d-sellos">Sellos</Label>
            <Input
              id="d-sellos"
              value={sellosRegalo}
              onChange={(e) => setSellosRegalo(e.target.value.replace(/[^0-9]/g, ''))}
              inputMode="numeric"
              placeholder="Sin sellos"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="d-puntos">Puntos</Label>
            <Input
              id="d-puntos"
              value={puntosRegalo}
              onChange={(e) => setPuntosRegalo(e.target.value.replace(/[^0-9]/g, ''))}
              inputMode="numeric"
              placeholder="Sin puntos"
            />
          </div>
        </div>
      </div>

      {/* Tope por cliente. */}
      <div className="space-y-3 rounded-xl border bg-card p-4">
        <div>
          <Label>Tope por cliente (opcional)</Label>
          <p className="text-xs text-muted-foreground">
            Cuanto puede acreditar este disparo a UN mismo cliente. Vacio = sin tope.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="d-pordia">Por dia</Label>
            <Input
              id="d-pordia"
              value={porDia}
              onChange={(e) => setPorDia(e.target.value.replace(/[^0-9]/g, ''))}
              inputMode="numeric"
              placeholder="Sin tope"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="d-pormes">Por mes</Label>
            <Input
              id="d-pormes"
              value={porMes}
              onChange={(e) => setPorMes(e.target.value.replace(/[^0-9]/g, ''))}
              inputMode="numeric"
              placeholder="Sin tope"
            />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="d-activa">Activo</Label>
        <Switch id="d-activa" checked={activa} onCheckedChange={setActiva} />
      </div>

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!puedeGuardar}>
          {guardando ? 'Guardando...' : disparo ? 'Guardar cambios' : 'Crear disparo'}
        </Button>
      </div>
    </form>
  );
}

/** Elige un cliente del negocio y manda el disparo como prueba. */
function ProbarDisparo({ disparo, onCerrar }: { disparo: DisparoPush; onCerrar: () => void }) {
  const [busqueda, setBusqueda] = React.useState('');
  const [clientes, setClientes] = React.useState<ClienteResumen[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [enviando, setEnviando] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelado = false;
    const filtros: { search?: string; pageSize?: number } = { pageSize: 20 };
    const termino = busqueda.trim();
    if (termino !== '') filtros.search = termino;
    const t = setTimeout(
      () => {
        clientesApi
          .listar(filtros)
          .then((r) => {
            if (cancelado) return;
            setClientes(Array.isArray(r?.data) ? r.data : []);
            setError(null);
          })
          .catch((e) => {
            if (cancelado) return;
            setClientes([]);
            setError(normalizarError(e).mensaje);
          });
      },
      termino === '' ? 0 : 300,
    );
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [busqueda]);

  async function probar(c: ClienteResumen) {
    setEnviando(c.id);
    try {
      const r = await disparosApi.probar(disparo.id, c.id);
      toast.success(`Prueba de "${disparo.nombre}" enviada a ${c.nombre}`, {
        description:
          r?.enviados != null ? `${r.enviados} notificacion(es) encolada(s)` : undefined,
      });
      onCerrar();
    } catch (e) {
      toast.error(`No se pudo probar. ${normalizarError(e).mensaje}`);
    } finally {
      setEnviando(null);
    }
  }

  return (
    <div className="space-y-3 pb-2">
      <p className="text-sm text-muted-foreground">
        Se manda <strong>solo a un cliente</strong> de prueba, para ver como llega.
      </p>
      <div className="space-y-2">
        <Label htmlFor="d-buscar">Buscar cliente</Label>
        <Input
          id="d-buscar"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Nombre o telefono"
          autoCapitalize="none"
        />
      </div>

      {clientes === null ? <Skeleton className="h-24 w-full" /> : null}

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {clientes && clientes.length === 0 && !error ? (
        <p className="text-sm text-muted-foreground">No hay clientes que coincidan.</p>
      ) : null}

      <ul className="divide-y rounded-xl border">
        {clientes?.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{c.nombre}</p>
              {c.telefono ? (
                <p className="truncate text-xs text-muted-foreground">{c.telefono}</p>
              ) : null}
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={enviando !== null}
              onClick={() => void probar(c)}
            >
              {enviando === c.id ? 'Enviando...' : 'Probar'}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
