'use client';

import { create } from 'zustand';
import type { SuperAdminSesion } from '@/types/api';

interface SuperAdminState {
  superadmin: SuperAdminSesion['superadmin'] | null;
  autenticado: boolean;
  cargando: boolean;
  fijarSesion: (sesion: SuperAdminSesion) => void;
  limpiar: () => void;
}

/**
 * Sesion del operador de la plataforma.
 *
 * Igual que en las otras PWAs NO se persiste nada: la sesion vive en la cookie HttpOnly
 * (`superadmin_token`) y este store solo cachea lo que devolvio el backend para no
 * repetir la request en cada render. Guardar el token en localStorage mudaria la sesion
 * a un lugar que JS puede leer (y robar con un XSS).
 */
export const useSuperAdminStore = create<SuperAdminState>((set) => ({
  superadmin: null,
  autenticado: false,
  cargando: true,
  fijarSesion: (sesion) => set({ superadmin: sesion.superadmin, autenticado: true, cargando: false }),
  limpiar: () => set({ superadmin: null, autenticado: false, cargando: false }),
}));
