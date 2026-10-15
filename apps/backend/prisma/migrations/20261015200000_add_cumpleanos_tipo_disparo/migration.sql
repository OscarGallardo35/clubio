-- Disparo de CUMPLEANOS (fase 2 del perfilado progresivo): nuevo valor del enum
-- `TipoDisparo`. Aditiva: `ALTER TYPE ... ADD VALUE` no toca las filas existentes.
--
-- Va en su PROPIA migracion (y sola) porque Postgres no permite USAR un valor recien
-- agregado al enum dentro de la MISMA transaccion que lo crea; `prisma migrate deploy`
-- corre cada migracion en su transaccion. Separarlo es el patron seguro.
--
-- Generado con:
--   prisma migrate diff --from-schema-datasource ./prisma/schema.prisma \
--                       --to-schema-datamodel ./prisma/schema.prisma --script
-- y se conserva solo el `ALTER TYPE` (el resto del diff era el `DROP TABLE "playing_with_neon"`
-- de siempre, que se omite desde la primera migracion).

-- AlterEnum
ALTER TYPE "TipoDisparo" ADD VALUE 'CUMPLEANOS';
