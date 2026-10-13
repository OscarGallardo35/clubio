'use client';

/**
 * Subida de una imagen a Cloudinary SIN que el binario pase por el backend.
 *
 * Flujo (dos tramos, a proposito):
 *   1. El consumidor pide la FIRMA a su propio backend (el panel de plataforma y el admin del
 *      dueno tienen endpoints de firma distintos) y devuelve timestamp/signature/apiKey/
 *      cloudName/folder/transformation. El backend NO ve el archivo.
 *   2. El `FormData` con el file va del NAVEGADOR directo a
 *      `https://api.cloudinary.com/v1_1/<cloudName>/image/upload`. Ahi vuelve el `secure_url`,
 *      que es lo que se guarda en el `fotoUrl` del item.
 *
 * Este componente es COMPARTIDO: vive en `@repo/ui` y lo usan el admin del dueno y el panel
 * de plataforma. Por eso la firma entra por prop (`firmar`) y el mensaje de error se traduce
 * con el normalizador del consumidor (`mensajeDeError`): el paquete no conoce ni la sesion ni
 * el cliente HTTP de cada app.
 *
 * Estados: idle -> subiendo -> listo | error (con reintento sobre el mismo archivo).
 */

import * as React from 'react';
import { Button } from './button';
import { Input } from './input';
import { Label } from './label';

/** Formatos aceptados y peso maximo: se validan en el cliente ANTES de pedir la firma. */
const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp'] as const;
const TAMANO_MAXIMO_BYTES = 5 * 1024 * 1024; // 5 MB
const ACEPTA = TIPOS_PERMITIDOS.join(',');

/** Lo que devuelve el endpoint de firma del backend. */
export interface FirmaSubidaMedia {
  timestamp: number;
  signature: string;
  apiKey: string;
  cloudName: string;
  folder: string;
  transformation: string;
}

/** Respuesta del upload directo a Cloudinary (el subconjunto que consumimos). */
export interface RespuestaSubidaCloudinary {
  secure_url: string;
  public_id: string;
  format?: string;
  width?: number;
  height?: number;
  bytes?: number;
}

export type EstadoSubida = 'idle' | 'subiendo' | 'listo' | 'error';

export interface SubirImagenProps {
  /** URL actual (el `fotoUrl` del item). Vacio/null = sin foto. */
  valor: string | null | undefined;
  /** Se llama con el `secure_url` de Cloudinary (o '' al quitar la foto). */
  onCambio: (url: string) => void;
  etiqueta?: string | undefined;
  /** Pide la FIRMA al backend del consumidor (el binario no pasa por el backend). */
  firmar: (tipo: string) => Promise<FirmaSubidaMedia>;
  /** Tipo de subida (carpeta/transformacion del backend). Por defecto 'carta'. */
  tipo?: string | undefined;
  /** Normalizador de errores de la app consumidora (ApiError -> mensaje). */
  mensajeDeError?: ((e: unknown) => string) | undefined;
}

/** Fallback cuando el consumidor no pasa su normalizador. */
function mensajePorDefecto(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return 'No pudimos completar la operacion';
}

export function SubirImagen({
  valor,
  onCambio,
  etiqueta = 'Foto del item',
  firmar,
  tipo = 'carta',
  mensajeDeError = mensajePorDefecto,
}: SubirImagenProps) {
  const [estado, setEstado] = React.useState<EstadoSubida>('idle');
  const [error, setError] = React.useState<string | null>(null);
  // Archivo elegido: queda guardado para poder REINTENTAR sin volver a abrir el selector.
  const [archivo, setArchivo] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  // El id del input tiene que ser unico en el documento: puede haber dos en la misma pantalla.
  const idInput = React.useId();

  // Object URL del archivo elegido (para el preview inmediato, antes de subir).
  React.useEffect(() => {
    if (!archivo) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(archivo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [archivo]);

  // La URL que se muestra: el archivo elegido manda; si no, el valor guardado.
  const mostrar = preview ?? (valor && valor.trim() !== '' ? valor : null);

  const reiniciar = () => {
    setEstado('idle');
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  async function subir(file: File) {
    setEstado('subiendo');
    setError(null);
    try {
      // 1) Firma (la cookie de la sesion viaja sola: el ApiClient usa credentials:'include').
      const firma = await firmar(tipo);

      // 2) Multipart directo a Cloudinary. OJO: NO se setea Content-Type; el browser pone el
      //    boundary. Todo lo firmado (folder/transformation/timestamp) tiene que viajar identico.
      const fd = new FormData();
      fd.append('file', file);
      fd.append('api_key', firma.apiKey);
      fd.append('timestamp', String(firma.timestamp));
      fd.append('signature', firma.signature);
      fd.append('folder', firma.folder);
      fd.append('transformation', firma.transformation);

      const res = await fetch(
        `https://api.cloudinary.com/v1_1/${firma.cloudName}/image/upload`,
        { method: 'POST', body: fd },
      );
      const data = (await res.json().catch(() => null)) as
        | (RespuestaSubidaCloudinary & { error?: { message?: string } })
        | null;

      if (!res.ok || !data?.secure_url) {
        throw new Error(data?.error?.message || `Cloudinary respondio ${res.status}`);
      }
      onCambio(data.secure_url);
      setEstado('listo');
    } catch (e) {
      setError(mensajeDeError(e));
      setEstado('error');
    }
  }

  function elegir(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Validacion en el cliente: sin esto se subiria el archivo a Cloudinary y fallaria alla.
    if (!(TIPOS_PERMITIDOS as readonly string[]).includes(file.type)) {
      setArchivo(null);
      setError('Formato no soportado. Usa JPG, PNG o WebP.');
      setEstado('error');
      return;
    }
    if (file.size > TAMANO_MAXIMO_BYTES) {
      setArchivo(null);
      setError('La imagen supera los 5 MB.');
      setEstado('error');
      return;
    }
    setArchivo(file);
    void subir(file);
  }

  function quitar() {
    setArchivo(null);
    reiniciar();
    onCambio('');
  }

  const mensajes: Record<EstadoSubida, string> = {
    idle: 'Sin subir todavia.',
    subiendo: 'Subiendo a Cloudinary...',
    listo: 'Listo: la foto se guardara al guardar el item.',
    error: 'No se pudo subir.',
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={idInput}>{etiqueta}</Label>

      <div
        className="flex h-40 w-full items-center justify-center overflow-hidden rounded-xl border border-dashed bg-muted"
        data-estado={mostrar ? 'imagen' : 'placeholder'}
      >
        {mostrar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mostrar} alt="Vista previa de la foto" className="h-full w-full object-cover" />
        ) : (
          <span className="text-sm text-muted-foreground">Sin foto (se muestra el placeholder)</span>
        )}
      </div>

      <Input
        id={idInput}
        ref={inputRef}
        type="file"
        accept={ACEPTA}
        onChange={elegir}
        disabled={estado === 'subiendo'}
      />

      <p role="status" className="text-xs text-muted-foreground">
        {mensajes[estado]} (JPG, PNG o WebP, hasta 5 MB)
      </p>

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {estado === 'error' && archivo ? (
          <Button type="button" variant="outline" onClick={() => void subir(archivo)}>
            Reintentar
          </Button>
        ) : null}
        {mostrar ? (
          <Button type="button" variant="outline" onClick={quitar} disabled={estado === 'subiendo'}>
            Quitar foto
          </Button>
        ) : null}
      </div>
    </div>
  );
}
