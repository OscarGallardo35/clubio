/**
 * Las plantillas de la FABRICA DE DEMOS, tal como las define el backend
 * (`apps/backend/src/superadmin/plantillas-demo.ts`).
 *
 * Esto NO se inventa: los conteos de items, el modo de fidelizacion, el premio y los sellos
 * son los que el backend crea de verdad, y lo que el operador ve antes de provisionar tiene
 * que coincidir con lo que va a pasar. Si una plantilla cambia en el backend y no aca, esto
 * miente (y el operador lo promete en una visita) — por eso los numeros se copian del
 * archivo del backend y no se estiman.
 *
 * Los empleados (dueno con email+password y encargado con PIN) y el cliente demo (3 sellos)
 * son iguales en las cuatro plantillas: los agrega el servicio, no la plantilla.
 */
import type { PlantillaDemo } from '@/types/api';

export interface Plantilla {
  id: PlantillaDemo;
  nombre: string;
  /** Para quien es (una linea). */
  ideal: string;
  /** Que trae la carta. */
  carta: string;
  /** Items de carta que crea la plantilla (conteo exacto del backend). */
  items: number;
  /** Modo de fidelizacion, en palabras. */
  modo: string;
  /** Sellos que hacen falta para el premio. */
  sellos: number;
  /** Que gana el cliente. */
  premio: string;
  /** Color de acento de la tarjeta que aplica la plantilla. */
  acento: string;
}

export const PLANTILLAS: Plantilla[] = [
  {
    id: 'lomiteria',
    nombre: 'Lomiteria',
    ideal: 'Casa de lomitos con pedidos para llevar.',
    carta: 'Lomitos, acompanantes y bebidas',
    items: 5,
    modo: 'solo visitas',
    sellos: 8,
    premio: 'Lomito gratis',
    acento: '#FFD166',
  },
  {
    id: 'bar',
    nombre: 'Bar / cerveceria',
    ideal: 'Bar con mesas, after office y picadas.',
    carta: 'Cervezas, tragos, comida y sin alcohol',
    items: 6,
    modo: 'hibrido (sellos + puntos por consumo)',
    sellos: 6,
    premio: 'Pinta artesanal de regalo',
    acento: '#F59E0B',
  },
  {
    id: 'cafeteria',
    nombre: 'Cafeteria',
    ideal: 'Cafeteria de especialidad con take away.',
    carta: 'Cafeteria y pasteleria',
    items: 5,
    modo: 'solo visitas',
    sellos: 6,
    premio: 'Cafe con dos medialunas',
    acento: '#FBBF24',
  },
  {
    id: 'basica',
    nombre: 'Basica',
    ideal: 'Cualquier rubro: la carta minima y la tarjeta con el diseno por defecto.',
    carta: 'Principales y bebidas',
    items: 3,
    modo: 'solo visitas',
    sellos: 10,
    premio: 'Premio de bienvenida',
    acento: '#E11D48',
  },
];

/** Empleados de ejemplo que arma el provisioning (iguales en las cuatro plantillas). */
export const EMPLEADOS_DEMO = 2;
/** Sellos con los que nace el cliente demo. */
export const SELLOS_CLIENTE_DEMO = 3;

export function plantillaPorId(id: PlantillaDemo): Plantilla {
  const encontrada = PLANTILLAS.find((p) => p.id === id);
  // `?? PLANTILLAS[0]!`: con noUncheckedIndexedAccess el indice puede ser undefined; la lista
  // nunca esta vacia (es una constante literal con cuatro entradas).
  return encontrada ?? PLANTILLAS[0]!;
}
