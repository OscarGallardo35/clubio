import { z } from 'zod'

/**
 * ID de cuid, el formato que genera Prisma con @default(cuid()) en este proyecto.
 *
 * NO usar z.string().uuid(): ningun endpoint acepta UUIDs. Un schema con .uuid()
 * rechaza IDs reales, y el error que se ve es "ID inválido" sobre un ID correcto.
 *
 * cuid() = 'c' + 24 caracteres [a-z0-9]  (25 en total).
 */
export const cuidSchema = z.string().regex(/^c[a-z0-9]{24}$/, 'ID inválido')
