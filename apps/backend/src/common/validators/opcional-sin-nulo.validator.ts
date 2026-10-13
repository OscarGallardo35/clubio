import { ValidateIf, isHexColor, registerDecorator } from 'class-validator';

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

/**
 * Un hex obligatorio que NO se puede vaciar (ej. `colorPrimario`/`colorSecundario`, NOT NULL).
 *
 * Es un unico validador a proposito: combinar `OpcionalSinNulo` con `@IsHexColor()` daria DOS
 * mensajes para un mismo `null` (uno de cada validador) y la UI los muestra concatenados. Aca el
 * mensaje es UNO y depende del caso: `null` -> "no se puede vaciar"; cualquier otra cosa ->
 * "tiene que ser un hex".
 */
export function HexColorObligatorio(etiqueta: string, ejemplo = '#E11D48'): PropertyDecorator {
  return (target, propertyName) => {
    ValidateIf((_objeto, valor) => valor !== undefined)(target, propertyName);
    registerDecorator({
      name: 'hexColorObligatorio',
      target: target.constructor,
      propertyName: String(propertyName),
      validator: {
        validate: (valor: unknown) => typeof valor === 'string' && isHexColor(valor),
        defaultMessage: (args) =>
          (args?.value ?? null) === null
            ? `${etiqueta} no se puede vaciar: elegi otro color en hex (ej. ${ejemplo}).`
            : `${etiqueta} tiene que ser un hex de 6 digitos (ej. ${ejemplo}).`,
      },
    });
  };
}
