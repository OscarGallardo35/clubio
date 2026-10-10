'use client';

import * as React from 'react';
import {
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  toast,
} from '@repo/ui';
import { disparosApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';
import type { DisparoPushLogItem } from '@/types/api';

/**
 * Historial de disparos (pestana "Historial" dentro de Notificaciones).
 *
 * Lee `GET /push/disparos/logs`: una fila por EJECUCION del motor (y por eso
 * tambien aparecen los OMITIDOS: tope por cliente, repetido, sin suscripcion).
 * Muestra cuando, a quien, que disparo/plantilla, si el push se encolo y cuanto
 * saldo se acredito de verdad.
 *
 * Fuente: `DisparoPushLog`. Ojo: el log se borra en CASCADA cuando se elimina el
 * disparo, asi que la historia de un disparo desaparece con el.
 */

const TAMANO = 20;

const ETIQUETA_TIPO: Record<string, string> = {
  COMPRA: 'Compra',
  SELLOS: 'Sellos',
  DIA: 'Dia',
  INACTIVIDAD: 'Inactividad',
  BIENVENIDA: 'Bienvenida',
  MANUAL: 'Manual',
};

/** Filtro por `accion` (los valores son los literales del backend). */
const FILTROS: { valor: string; etiqueta: string }[] = [
  { valor: 'TODOS', etiqueta: 'Todo' },
  { valor: 'ENVIADO', etiqueta: 'Enviados' },
  { valor: 'OMITIDO_LIMITE', etiqueta: 'Omitidos por tope' },
  { valor: 'OMITIDO_DUP', etiqueta: 'Omitidos por repetido' },
  { valor: 'OMITIDO_SIN_SUSCRIPCION', etiqueta: 'Omitidos sin suscripcion' },
];

const ACCION_ETIQUETA: Record<string, string> = {
  ENVIADO: 'Enviado',
  OMITIDO_LIMITE: 'Omitido (tope)',
  OMITIDO_DUP: 'Omitido (repetido)',
  OMITIDO_SIN_SUSCRIPCION: 'Omitido (sin suscripcion)',
};

/** "12/10 18:30" en hora local; el ISO crudo si el parseo falla. */
function fechaHora(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/** "+1 sello · +10 puntos", "0" si no acredito nada. */
function saldo(item: DisparoPushLogItem): string {
  const partes: string[] = [];
  if (item.sellosAcreditados) {
    partes.push(`+${item.sellosAcreditados} ${item.sellosAcreditados === 1 ? 'sello' : 'sellos'}`);
  }
  if (item.puntosAcreditados) {
    partes.push(`+${item.puntosAcreditados} ${item.puntosAcreditados === 1 ? 'punto' : 'puntos'}`);
  }
  return partes.length > 0 ? partes.join(' · ') : '0';
}

export function Historial() {
  const [filas, setFilas] = React.useState<DisparoPushLogItem[] | null>(null);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [filtro, setFiltro] = React.useState('TODOS');
  const [error, setError] = React.useState<string | null>(null);

  const refetch = React.useCallback(async () => {
    try {
      const r = await disparosApi.historial({
        page,
        pageSize: TAMANO,
        ...(filtro !== 'TODOS' ? { accion: filtro } : {}),
      });
      setFilas(Array.isArray(r?.data) ? r.data : []);
      setTotal(Number.isFinite(r?.total) ? Number(r.total) : 0);
      setError(null);
    } catch (e) {
      const { status, mensaje } = normalizarError(e);
      if (status !== 401) setError(mensaje);
      setFilas([]);
    }
  }, [page, filtro]);

  React.useEffect(() => {
    void refetch();
  }, [refetch]);

  React.useEffect(() => {
    if (error) toast.error('No pudimos traer el historial', { description: error });
  }, [error]);

  const totalPaginas = Math.max(1, Math.ceil(total / TAMANO));
  const cargando = filas === null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-sm text-muted-foreground">
            {cargando ? 'Cargando...' : `${total} ejecucion${total === 1 ? '' : 'es'} registradas`}
          </p>
          <p className="text-xs text-muted-foreground">
            Incluye los omitidos (tope, repetido, sin suscripcion): si algo no salio, se ve por que.
          </p>
        </div>
        <div className="w-full sm:w-56">
          <Select
            value={filtro}
            onValueChange={(v) => {
              setFiltro(v);
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Filtrar por resultado">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FILTROS.map((f) => (
                <SelectItem key={f.valor} value={f.valor}>
                  {f.etiqueta}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {cargando && !error ? <Skeleton className="h-64 w-full" /> : null}

      {!cargando && filas.length === 0 ? (
        <p className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
          {filtro === 'TODOS'
            ? 'Todavia no hay ejecuciones. Cuando un disparo se dispare, aparece aca.'
            : 'No hay ejecuciones con ese filtro.'}
        </p>
      ) : null}

      {filas && filas.length > 0 ? (
        <ul className="divide-y rounded-2xl border bg-card">
          {filas.map((f) => (
            <li key={f.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium tabular-nums">{fechaHora(f.creadoEn)}</span>
                  <Badge variant="outline" className="shrink-0">
                    {ETIQUETA_TIPO[f.tipo] ?? f.tipo}
                  </Badge>
                  {f.accion === 'ENVIADO' ? (
                    <Badge variant="secondary" className="shrink-0 bg-emerald-100 text-emerald-800">
                      {ACCION_ETIQUETA[f.accion]}
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="shrink-0 text-muted-foreground">
                      {ACCION_ETIQUETA[f.accion] ?? f.accion}
                    </Badge>
                  )}
                </div>
                <p className="truncate text-sm">
                  <span className="text-muted-foreground">Cliente: </span>
                  <span className="font-medium">{f.clienteNombre ?? 'sin cliente'}</span>
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {f.disparoNombre}
                  {f.plantillaNombre ? ` · plantilla: ${f.plantillaNombre}` : ''}
                  {f.origen ? ` · origen: ${f.origen}` : ''}
                </p>
              </div>

              <div className="shrink-0 space-y-0.5 text-left sm:text-right">
                {f.accion === 'ENVIADO' ? (
                  <p className="text-sm">
                    {f.pushEncolados > 0 ? (
                      <span className="text-emerald-700">Push encolado</span>
                    ) : (
                      <span className="text-amber-700">
                        Push no encolado{f.pushMotivo ? ` (${f.pushMotivo})` : ''}
                      </span>
                    )}
                  </p>
                ) : f.omitidoMotivo ? (
                  <p className="text-sm text-amber-700">Motivo: {f.omitidoMotivo}</p>
                ) : null}
                <p className="text-sm tabular-nums">
                  <span className="text-muted-foreground">Saldo: </span>
                  <span
                    className={
                      f.sellosAcreditados || f.puntosAcreditados
                        ? 'font-medium text-emerald-700'
                        : 'text-muted-foreground'
                    }
                  >
                    {saldo(f)}
                  </span>
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {filas && filas.length > 0 && totalPaginas > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Anterior
          </Button>
          <span className="text-xs tabular-nums text-muted-foreground">
            Pagina {page} de {totalPaginas}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPaginas}
            onClick={() => setPage((p) => Math.min(totalPaginas, p + 1))}
          >
            Siguiente
          </Button>
        </div>
      ) : null}
    </div>
  );
}
