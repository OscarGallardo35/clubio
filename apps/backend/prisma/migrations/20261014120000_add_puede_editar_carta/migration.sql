-- Permiso por empleado para administrar la carta completa (aditivo: columna con DEFAULT,
-- aplica seguro sobre una tabla con filas).
--
-- Nace APAGADO para todos: nadie gana permisos sin que el dueno prenda el switch.
ALTER TABLE "Empleado" ADD COLUMN "puedeEditarCarta" BOOLEAN NOT NULL DEFAULT false;
