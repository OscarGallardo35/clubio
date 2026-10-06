'use client'

import { create } from 'zustand';
import type { EmpleadoMe, NegocioStaff, SucursalStaff, EmpleadoStaff } from '@/types/api';

interface EmpleadoState {
  tipo: EmpleadoMe['tipo'] | null;
  empleado: EmpleadoStaff | null;
  negocio: NegocioStaff | null;
  sucursal: SucursalStaff | null;
  autenticado: boolean;
  cargando: boolean;
  /**
   * Token en MEMORIA, solo para el handshake del WebSocket: la cookie es HttpOnly
   * y JS no la puede leer. NO se persiste a proposito: la cookie ES la
   * persistencia de la sesion, asi que no hay nada que guardar aca.
   */
  token: string | null;
  fijarSesion: (me: EmpleadoMe) => void;
  fijarToken: (token: string | null) => void;
  limpiar: () => void;
}

export const useEmpleadoStore = create<EmpleadoState>((set) => ({
  tipo: null,
  empleado: null,
  negocio: null,
  sucursal: null,
  autenticado: false,
  cargando: true,
  token: null,
  fijarSesion: (me) =>
    set({
      tipo: me.tipo,
      empleado: me.empleado,
      negocio: me.negocio,
      sucursal: me.sucursal,
      autenticado: true,
      cargando: false,
    }),
  fijarToken: (token) => set({ token }),
  limpiar: () =>
    set({ tipo: null, empleado: null, negocio: null, sucursal: null, autenticado: false, cargando: false, token: null }),
}));
