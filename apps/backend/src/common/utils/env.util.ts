/**
 * Devuelve el valor de una variable de entorno obligatoria.
 * En PRODUCCION lanza si falta; en desarrollo permite un fallback explicito.
 * Evita que un despliegue arranque con secretos por defecto.
 */
export function requireEnv(name: string, devFallback: string): string {
  const value = process.env[name];
  if (value !== undefined && value.trim().length > 0) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`Falta la variable de entorno ${name} (obligatoria en produccion)`);
  }
  return devFallback;
}

/** ¿Estan todos los secretos JWT definidos y son DISTINTOS entre si? */
export function secretosJwtDistintos(): boolean {
  const names = ['JWT_EMPLEADO_SECRET', 'JWT_DUENO_SECRET', 'JWT_CLIENTE_SECRET', 'JWT_REFRESH_SECRET'];
  const vals = names.map((n) => process.env[n]).filter((v): v is string => !!v && v.trim() !== '');
  return vals.length === names.length && new Set(vals).size === names.length;
}
