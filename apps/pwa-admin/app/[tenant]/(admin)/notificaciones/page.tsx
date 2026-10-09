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
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Skeleton,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from '@repo/ui';
import { pushApi } from '@/lib/api';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { normalizarError } from '@/lib/errores';
import { renderizarPlantilla as renderizar } from '@/lib/push';
import { Disparos } from './Disparos';
import type {
  CatalogoPlantillas,
  CrearPlantillaBody,
  DatosEjemploPlantilla,
  PlantillaPush,
  SegmentoEnvio,
} from '@/types/api';

/**
 * Notificaciones (push) del panel del dueno.
 *
 * Plantillas reutilizables con variables {{nombre}} {{negocio}} {{premio}}
 * {{actuales}} {{meta}} {{faltantes}} {{numero}}. Todo pasa por
 * `@RequiereFeature('push')`: si el plan no la incluye, el backend responde 403 y
 * la pantalla lo muestra.
 *
 * La previsualizacion reemplaza las variables con datos de un cliente REAL del
 * negocio (`GET /push/plantillas/ejemplo`), asi el dueno ve el texto como le
 * llegaria a un cliente de verdad. "Enviar prueba" manda UNA notificacion al
 * dispositivo que el dueno tenga suscrito aca mismo.
 */
export default function NotificacionesPage() {
  const [plantillas, setPlantillas] = React.useState<PlantillaPush[] | null>(null);
  const [catalogo, setCatalogo] = React.useState<CatalogoPlantillas | null>(null);
  const [ejemplo, setEjemplo] = React.useState<DatosEjemploPlantilla | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [editando, setEditando] = React.useState<PlantillaPush | null>(null);
  const [creando, setCreando] = React.useState(false);
  const [aEliminar, setAEliminar] = React.useState<PlantillaPush | null>(null);
  const [borrando, setBorrando] = React.useState(false);
  const [enviando, setEnviando] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState('plantillas');

  const push = usePushNotifications();

  const refetch = React.useCallback(async () => {
    try {
      const [lista, cat] = await Promise.all([pushApi.listar(), pushApi.catalogo()]);
      setPlantillas(lista);
      setCatalogo(cat);
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
    // El ejemplo es best-effort: si falla, la preview usa placeholders.
    void pushApi
      .ejemplo()
      .then(setEjemplo)
      .catch(() => setEjemplo(null));
  }, []);

  React.useEffect(() => {
    if (error) toast.error('No pudimos traer las plantillas', { description: error });
  }, [error]);

  const confirmarEliminar = React.useCallback(async () => {
    if (!aEliminar) return;
    setBorrando(true);
    try {
      await pushApi.eliminar(aEliminar.id);
      toast.success(`Se elimino ${aEliminar.nombre}`);
      setAEliminar(null);
      await refetch();
    } catch (e) {
      toast.error(`No se pudo eliminar. ${normalizarError(e).mensaje}`);
    } finally {
      setBorrando(false);
    }
  }, [aEliminar, refetch]);

  /** Prueba a ESTE dispositivo (el navegador del dueno). */
  const enviarPrueba = React.useCallback(
    async (plantilla: PlantillaPush) => {
      if (!push.endpoint) {
        toast.error('Primero activa las notificaciones en este dispositivo');
        return;
      }
      setEnviando(`prueba-${plantilla.id}`);
      try {
        await pushApi.enviar({ plantillaId: plantilla.id, endpoint: push.endpoint });
        toast.success('Prueba enviada a este dispositivo');
      } catch (e) {
        toast.error(`No se pudo enviar la prueba. ${normalizarError(e).mensaje}`);
      } finally {
        setEnviando(null);
      }
    },
    [push.endpoint],
  );

  const enviarSegmento = React.useCallback(
    async (plantilla: PlantillaPush, segmento: SegmentoEnvio) => {
      setEnviando(`seg-${plantilla.id}-${segmento}`);
      try {
        const r = await pushApi.enviar({ plantillaId: plantilla.id, segmento });
        toast.success(`Encoladas ${r.encolados ?? 0} de ${r.destinatarios ?? 0} notificaciones`);
      } catch (e) {
        toast.error(`No se pudo enviar. ${normalizarError(e).mensaje}`);
      } finally {
        setEnviando(null);
      }
    },
    [],
  );

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Notificaciones</h1>
          <p className="text-sm text-muted-foreground">
            Plantillas de push, prueba en tu dispositivo y envio por segmentos.
          </p>
        </div>
        {tab === 'plantillas' ? (
          <Button onClick={() => setCreando(true)}>+ Nueva plantilla</Button>
        ) : null}
      </header>

      <DispositivoCard
        estado={push.estado}
        activo={push.activo}
        guardando={push.guardando}
        mensaje={push.mensaje}
        onActivar={() => void push.activar()}
      />

      {/* `TabsList` ya trae `w-full` + scroll interno: NO agregarle `w-max` (desborda en mobile). */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="gap-1">
          <TabsTrigger value="plantillas">Plantillas</TabsTrigger>
          <TabsTrigger value="disparos">Disparos</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === 'disparos' ? <Disparos plantillas={plantillas} ejemplo={ejemplo} /> : null}

      {tab === 'plantillas' ? (
        <>
          {plantillas === null && !error ? <Skeleton className="h-64 w-full" /> : null}

      {plantillas && plantillas.length === 0 ? (
        <p className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
          Todavia no hay plantillas. Crea la primera con &quot;+ Nueva plantilla&quot; (podes arrancar
          desde una sugerida).
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {plantillas?.map((p) => {
          const prev = renderizar(p.titulo, ejemplo);
          const prevCuerpo = renderizar(p.cuerpo, ejemplo);
          return (
            <article key={p.id} className="space-y-3 rounded-2xl border bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-base font-semibold">{p.nombre}</h2>
                    {p.activa ? (
                      <Badge variant="outline" className="shrink-0">
                        activa
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="shrink-0">
                        pausada
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">URL: {p.url ?? '/tarjeta'}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="outline" size="sm" onClick={() => setEditando(p)}>
                    Editar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive"
                    onClick={() => setAEliminar(p)}
                  >
                    Eliminar
                  </Button>
                </div>
              </div>

              {/* Preview con las variables ya reemplazadas por datos de un cliente real. */}
              <div className="rounded-xl border border-dashed bg-muted/40 p-3">
                <p className="text-sm font-medium">{prev}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{prevCuerpo}</p>
                {ejemplo ? (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Ejemplo con {ejemplo.nombre} ({ejemplo.actuales}/{ejemplo.meta} sellos)
                  </p>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!push.activo || enviando === `prueba-${p.id}`}
                  onClick={() => void enviarPrueba(p)}
                >
                  {enviando === `prueba-${p.id}` ? 'Enviando...' : 'Enviar prueba'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={enviando !== null}
                  onClick={() => void enviarSegmento(p, 'TODOS')}
                >
                  Todos
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={enviando !== null}
                  onClick={() => void enviarSegmento(p, 'PREMIO_DESBLOQUEADO')}
                >
                  Con premio
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={enviando !== null}
                  onClick={() => void enviarSegmento(p, 'INACTIVO_30')}
                >
                  Inactivos +30d
                </Button>
              </div>
            </article>
          );
        })}
      </div>

      <Dialog
        open={creando || editando !== null}
        onOpenChange={(abierto) => {
          if (!abierto) {
            setCreando(false);
            setEditando(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editando ? 'Editar plantilla' : 'Nueva plantilla'}</DialogTitle>
            <DialogDescription>
              Usa {'{{nombre}}'} {'{{negocio}}'} {'{{premio}}'} {'{{actuales}}'} {'{{meta}}'}{' '}
              {'{{faltantes}}'} {'{{numero}}'} para personalizar.
            </DialogDescription>
          </DialogHeader>
          <FormularioPlantilla
            key={editando?.id ?? 'nueva'}
            plantilla={editando}
            sugeridas={catalogo?.sugeridas ?? []}
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
        </DialogContent>
      </Dialog>

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
              Se borra la plantilla. Las notificaciones ya enviadas no se tocan.
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
        </>
      ) : null}
    </section>
  );
}

/** Card del estado de push del dispositivo actual (para "Enviar prueba"). */
function DispositivoCard({
  estado,
  activo,
  guardando,
  mensaje,
  onActivar,
}: {
  estado: string;
  activo: boolean;
  guardando: boolean;
  mensaje: string | null;
  onActivar: () => void;
}) {
  if (estado === 'no-soportado' || estado === 'cargando') return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-5">
      <div>
        <h2 className="text-base font-semibold">Probar en este dispositivo</h2>
        {activo ? (
          <p className="text-sm text-muted-foreground">
            Notificaciones activadas: podes mandarte una prueba.
          </p>
        ) : estado === 'requiere-instalacion' ? (
          <p className="text-sm text-muted-foreground">
            En iPhone instala la app (Compartir → Añadir a inicio) para poder recibir notificaciones.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Activa las notificaciones para recibir una prueba en este navegador.
          </p>
        )}
        {estado === 'denegado' ? (
          <p className="text-xs text-amber-600">
            Las bloqueaste antes: habilitalas en los ajustes del navegador.
          </p>
        ) : null}
        {mensaje ? <p className="text-xs text-amber-600">{mensaje}</p> : null}
      </div>
      {!activo && estado !== 'requiere-instalacion' && estado !== 'denegado' ? (
        <Button onClick={onActivar} disabled={guardando}>
          {guardando ? 'Activando...' : 'Activar notificaciones'}
        </Button>
      ) : null}
    </div>
  );
}

/** Alta y edicion comparten formulario: `plantilla` null = alta. */
function FormularioPlantilla({
  plantilla,
  sugeridas,
  ejemplo,
  onTerminar,
  onCancelar,
}: {
  plantilla: PlantillaPush | null;
  sugeridas: CatalogoPlantillas['sugeridas'];
  ejemplo: DatosEjemploPlantilla | null;
  onTerminar: () => void | Promise<void>;
  onCancelar: () => void;
}) {
  const [nombre, setNombre] = React.useState(plantilla?.nombre ?? '');
  const [titulo, setTitulo] = React.useState(plantilla?.titulo ?? '');
  const [cuerpo, setCuerpo] = React.useState(plantilla?.cuerpo ?? '');
  const [url, setUrl] = React.useState(plantilla?.url ?? '/tarjeta');
  const [activa, setActiva] = React.useState(plantilla?.activa ?? true);
  const [guardando, setGuardando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const puedeGuardar =
    nombre.trim().length >= 2 && titulo.trim().length >= 1 && cuerpo.trim().length >= 1 && !guardando;

  function usarSugerida(index: number) {
    const s = sugeridas[index];
    if (!s) return;
    setNombre(s.nombre);
    setTitulo(s.titulo);
    setCuerpo(s.cuerpo);
    setUrl(s.url);
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!puedeGuardar) return;
    setGuardando(true);
    setError(null);
    try {
      const body: CrearPlantillaBody = {
        nombre: nombre.trim(),
        titulo: titulo.trim(),
        cuerpo: cuerpo.trim(),
        url: url.trim(),
        activa,
      };
      if (plantilla) await pushApi.actualizar(plantilla.id, body);
      else await pushApi.crear(body);
      toast.success(plantilla ? 'Plantilla actualizada' : 'Plantilla creada');
      await onTerminar();
    } catch (err) {
      setError(normalizarError(err).mensaje);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-4">
      {!plantilla && sugeridas.length > 0 ? (
        <div className="space-y-2">
          <Label>Arrancar desde una sugerida</Label>
          <div className="flex flex-wrap gap-2">
            {sugeridas.map((s, i) => (
              <Button key={s.nombre} type="button" variant="outline" size="sm" onClick={() => usarSugerida(i)}>
                {s.nombre}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="p-nombre">Nombre interno</Label>
        <Input
          id="p-nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value.slice(0, 80))}
          placeholder="Premio desbloqueado"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="p-titulo">Titulo</Label>
        <Input
          id="p-titulo"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value.slice(0, 120))}
          placeholder="¡Premio desbloqueado!"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="p-cuerpo">Mensaje</Label>
        <Textarea
          id="p-cuerpo"
          value={cuerpo}
          onChange={(e) => setCuerpo(e.target.value.slice(0, 500))}
          placeholder="Mostra esta pantalla en {{negocio}} para canjear tu {{premio}}."
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="p-url">URL al abrir (deep link)</Label>
        <Input
          id="p-url"
          value={url}
          onChange={(e) => setUrl(e.target.value.slice(0, 200))}
          placeholder="/tarjeta"
          autoCapitalize="none"
          spellCheck={false}
        />
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="p-activa">Activa</Label>
        <Switch id="p-activa" checked={activa} onCheckedChange={setActiva} />
      </div>

      {/* Preview en vivo, con las variables ya reemplazadas. */}
      <div className="rounded-xl border border-dashed bg-muted/40 p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Preview</p>
        <p className="mt-1 text-sm font-medium">{renderizar(titulo || '(sin titulo)', ejemplo)}</p>
        <p className="text-sm text-muted-foreground">{renderizar(cuerpo || '(sin mensaje)', ejemplo)}</p>
      </div>

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!puedeGuardar}>
          {guardando ? 'Guardando...' : plantilla ? 'Guardar cambios' : 'Crear plantilla'}
        </Button>
      </DialogFooter>
    </form>
  );
}
