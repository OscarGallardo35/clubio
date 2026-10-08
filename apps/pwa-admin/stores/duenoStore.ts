'use client';

import { create } from 'zustand';
import type { DuenoSesion } from '@/types/api';

interface DuenoState {
  dueno: DuenoSesion['dueno'] | null;
  negocio: DuenoSesion['negocio'] | null;
  autenticado: boolean;
  cargando: boolean;
  fijarSesion: (sesion: DuenoSesion) => void;
  limpiar: () => void;
}

/**
 * Sesion del dueno.
 *
 * Igual que en la PWA Staff, aca NO se persiste nada: la sesion vive en la cookie HttpOnly
 * (`dueno_token`) y este store solo cachea lo que devolvio el backend, para no repetir la
 * request en cada render. Guardar el token en localStorage seria mudar la sesion a un lugar
 * que JS puede leer (y robar con un XSS).
 */
export const useDuenoStore = create<DuenoState>((set) => ({
  dueno: null,
  negocio: null,
  autenticado: false,
  cargando: true,
  fijarSesion: (sesion) =>
    set({ dueno: sesion.dueno, negocio: sesion.negocio, autenticado: true, cargando: false }),
  limpiar: () => set({ dueno: null, negocio: null, autenticado: false, cargando: false }),
}));
