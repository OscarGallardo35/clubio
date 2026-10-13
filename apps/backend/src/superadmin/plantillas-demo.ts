import { ModoFidelizacion } from '@prisma/client';

/**
 * PLANTILLAS DE DEMO de la fabrica (`POST /locales/:negocioId/provisionar`).
 *
 * Referencia EXACTA de que crea un local demo: `apps/backend/scripts/seed-que-lomitos.cjs`.
 * `lomiteria` reproduce ese seed (mismos valores: SOLO_VISITAS, 8 sellos, 'Lomito gratis',
 * color #C8102E); las otras tres son variantes del mismo esqueleto para vender un rubro
 * distinto sin recargar el brief.
 *
 * Las plantillas NO incluyen empleados: el DUENO (email + password) y el ENCARGADO (PIN) son
 * los mismos en las cuatro y los arma el servicio (el email del dueno lleva el slug del local).
 */

export interface ItemPlantillaDemo {
  categoria: string;
  nombre: string;
  descripcion?: string;
  /** Precio en pesos (Decimal(10,2) en la DB). */
  precio: number;
  etiquetas?: string[];
  orden?: number;
}

export interface ConfigPlantillaDemo {
  modoFidelizacion: ModoFidelizacion;
  sellosParaPremio: number;
  premioTexto: string;
  sellosBienvenida: number;
  limiteVisitasPorDia: number;
  horasMinimasEntreVisitas: number;
  mensajeBienvenida: string;
  mostrarResenaPostVisita: boolean;
  menuActivo: boolean;
  /** Programa por puntos (solo se usa en HIBRIDO). */
  puntosPorMil?: number;
  premioPorPuntos?: number;
  premioTextoPuntos?: string;
}

export interface PlantillaDemo {
  descripcion: string;
  colorPrimario: string;
  colorSecundario: string;
  /** `TenantTheme` o null (el local queda con el diseno por defecto de la tarjeta). */
  theme: Record<string, unknown> | null;
  config: ConfigPlantillaDemo;
  items: ItemPlantillaDemo[];
}

/** Theme de la tarjeta con los colores del rubro. `imagenFondo: null` = fondo plano. */
function tema(bg: string, accent: string, brandDark: string): Record<string, unknown> {
  return {
    colores: { bg, accent, brandDark, text: '#FFFFFF', textMuted: 'rgba(255,255,255,0.45)' },
    sello: { rotacionBase: 0, forma: 'circulo' },
    imagenFondo: null,
    mostrarPuntos: false,
  };
}

export const PLANTILLAS_DEMO: Record<string, PlantillaDemo> = {
  /** Mismo local que `seed-que-lomitos.cjs`: la referencia de "local demo completo". */
  lomiteria: {
    descripcion: 'Lomiteria clasica con carta corta, 8 sellos y premio de lomito gratis.',
    colorPrimario: '#C8102E',
    colorSecundario: '#FFFFFF',
    theme: tema('#C8102E', '#FFD166', '#7A0A1C'),
    config: {
      modoFidelizacion: ModoFidelizacion.SOLO_VISITAS,
      sellosParaPremio: 8,
      premioTexto: 'Lomito gratis',
      sellosBienvenida: 1,
      limiteVisitasPorDia: 1,
      horasMinimasEntreVisitas: 4,
      mensajeBienvenida: 'Suma 8 sellos y te llevas un lomito gratis.',
      mostrarResenaPostVisita: true,
      menuActivo: true,
    },
    items: [
      { categoria: 'Lomitos', nombre: 'Lomito completo', descripcion: 'Lomo, jamon, queso, huevo, lechuga y tomate', precio: 8900, etiquetas: [], orden: 1 },
      { categoria: 'Lomitos', nombre: 'Lomito de pollo', descripcion: 'Pollo grillado con mayonesa casera', precio: 7900, etiquetas: [], orden: 2 },
      { categoria: 'Acompanantes', nombre: 'Papas fritas', descripcion: 'Porcion grande, bien crocantes', precio: 3500, etiquetas: ['vegetariano'], orden: 1 },
      { categoria: 'Bebidas', nombre: 'Coca-Cola 500ml', descripcion: 'Bien fria', precio: 1800, etiquetas: [], orden: 1 },
      { categoria: 'Bebidas', nombre: 'Agua mineral 500ml', descripcion: 'Con o sin gas', precio: 1200, etiquetas: [], orden: 2 },
    ],
  },

  bar: {
    descripcion: 'Bar con programa HIBRIDO (sellos + puntos), after office y picadas.',
    colorPrimario: '#0F766E',
    colorSecundario: '#FDE68A',
    theme: tema('#0F766E', '#F59E0B', '#134E4A'),
    config: {
      modoFidelizacion: ModoFidelizacion.HIBRIDO,
      sellosParaPremio: 6,
      premioTexto: 'Pinta artesanal de regalo',
      sellosBienvenida: 1,
      limiteVisitasPorDia: 2,
      horasMinimasEntreVisitas: 2,
      mensajeBienvenida: 'Junta 6 sellos y la proxima pinta va por la casa. Tambien sumas puntos por consumo.',
      mostrarResenaPostVisita: true,
      menuActivo: true,
      puntosPorMil: 5,
      premioPorPuntos: 500,
      premioTextoPuntos: 'Tabla de picada para 2',
    },
    items: [
      { categoria: 'Cervezas', nombre: 'Pinta IPA', descripcion: 'Amarga e intensa, 500ml', precio: 4200, etiquetas: [], orden: 1 },
      { categoria: 'Cervezas', nombre: 'Pinta Golden', descripcion: 'Suave y refrescante, 500ml', precio: 3800, etiquetas: [], orden: 2 },
      { categoria: 'Tragos', nombre: 'Gin tonic', descripcion: 'Gin, tonica, limon y romero', precio: 5500, etiquetas: [], orden: 1 },
      { categoria: 'Comida', nombre: 'Tabla de picada', descripcion: 'Quesos, fiambres, aceitunas y pan casero', precio: 12900, etiquetas: [], orden: 1 },
      { categoria: 'Comida', nombre: 'Hamburguesa clasica', descripcion: 'Con papas fritas', precio: 8500, etiquetas: [], orden: 2 },
      { categoria: 'Sin alcohol', nombre: 'Limonada de la casa', descripcion: 'Jarra de 1 litro', precio: 2800, etiquetas: ['vegetariano'], orden: 1 },
    ],
  },

  cafeteria: {
    descripcion: 'Cafeteria de especialidad: 6 sellos, premio dulce y take away.',
    colorPrimario: '#7C3AED',
    colorSecundario: '#F5E6D3',
    theme: tema('#7C3AED', '#FBBF24', '#4C1D95'),
    config: {
      modoFidelizacion: ModoFidelizacion.SOLO_VISITAS,
      sellosParaPremio: 6,
      premioTexto: 'Cafe con dos medialunas',
      sellosBienvenida: 1,
      limiteVisitasPorDia: 2,
      horasMinimasEntreVisitas: 1,
      mensajeBienvenida: 'Con 6 visitas te invitamos un cafe con medialunas.',
      mostrarResenaPostVisita: true,
      menuActivo: true,
    },
    items: [
      { categoria: 'Cafeteria', nombre: 'Espresso doble', descripcion: 'Blend de la casa', precio: 2200, etiquetas: ['vegetariano'], orden: 1 },
      { categoria: 'Cafeteria', nombre: 'Flat white', descripcion: 'Leche texturada, 240ml', precio: 2900, etiquetas: ['vegetariano'], orden: 2 },
      { categoria: 'Cafeteria', nombre: 'Cold brew', descripcion: 'Infusion en frio, 12 horas', precio: 3200, etiquetas: ['vegano'], orden: 3 },
      { categoria: 'Pasteleria', nombre: 'Medialuna de manteca', descripcion: 'Recien horneada', precio: 900, etiquetas: ['vegetariano'], orden: 1 },
      { categoria: 'Pasteleria', nombre: 'Cheesecake de frutos rojos', descripcion: 'Porcion individual', precio: 3400, etiquetas: ['vegetariano'], orden: 2 },
    ],
  },

  /** Plantilla minima: sirve para mostrar el local SIN theme (diseno por defecto de la tarjeta). */
  basica: {
    descripcion: 'Local generico sin branding: carta minima y la tarjeta con el diseno por defecto.',
    colorPrimario: '#111827',
    colorSecundario: '#F59E0B',
    theme: null,
    config: {
      modoFidelizacion: ModoFidelizacion.SOLO_VISITAS,
      sellosParaPremio: 10,
      premioTexto: 'Premio de bienvenida',
      sellosBienvenida: 1,
      limiteVisitasPorDia: 1,
      horasMinimasEntreVisitas: 4,
      mensajeBienvenida: 'Suma 10 sellos y te llevas un premio de la casa.',
      mostrarResenaPostVisita: true,
      menuActivo: true,
    },
    items: [
      { categoria: 'Principales', nombre: 'Plato del dia', descripcion: 'Consulta la pizarra', precio: 7500, etiquetas: [], orden: 1 },
      { categoria: 'Principales', nombre: 'Milanesa con papas', descripcion: 'De carne o de pollo', precio: 8200, etiquetas: [], orden: 2 },
      { categoria: 'Bebidas', nombre: 'Gaseosa 500ml', descripcion: 'Linea Coca-Cola', precio: 1800, etiquetas: [], orden: 1 },
    ],
  },
};

export type PlantillaDemoKey = keyof typeof PLANTILLAS_DEMO;
