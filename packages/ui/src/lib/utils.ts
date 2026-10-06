import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Une clases de Tailwind resolviendo conflictos.
 * El ultimo gana: cn('p-2', 'p-4') -> 'p-4'.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
