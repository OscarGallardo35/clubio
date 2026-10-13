import { ValidateIf, registerDecorator } from 'class-validator';

/**
 * Campos que NO admiten `null` explicito (columnas NOT NULL, o campos sin semantica de borrado).
 *
 * El problema que resuelve: `@IsOptional()` de class-validator NO valida nada cuando el valor es
 * `null` (lo trata igual que `undefined`, que significa "no tocar"). Un `null` explicito pasaba el
 * DTO, llegaba tal cual a Prisma y una columna NOT NULL reventaba con un **500 "Error interno del
 * servidor"** en vez de un 400 que explique que ese campo no se puede vaciar.
 *
 * Semantica (la misma del contrato de la tanda 2):
 *  - `undefined` (ausente) -> NO tocar. Es lo que manda el admin del dueno cuando el campo esta
 *    vacio, asi que su comportamiento NO cambia.
 *  - `null` EXPLICITO      -> 400 con el mensaje que se pasa (`mensaje`).
 *
 * Los campos que SI tienen semantica de borrado (columnas nullable) siguen usando `@IsOptional()`
 * y aceptan `null` normalmente.
 */
export function OpcionalSinNulo(mensaje: string): PropertyDecorator {
  return (target, propertyName) => {
    // Solo se saltea el campo cuando falta del todo: el `null` cae en los validadores.
    ValidateIf((_objeto, valor) => valor !== undefined)(target, propertyName);
    registerDecorator({
      name: 'opcionalSinNulo',
      target: target.constructor,
      propertyName: String(propertyName),
      validator: {
        validate: (valor: unknown) => valor !== null,
        defaultMessage: () => mensaje,
      },
    });
  };
}
