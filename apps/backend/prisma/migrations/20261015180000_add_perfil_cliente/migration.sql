-- Perfilado progresivo del cliente (fase 1): genero, estado del pedido de perfilado y
-- consentimiento (Ley 25.326, Argentina).
--
-- Aditiva y SIN perdida de datos:
--  * `genero` y `consentimientoPerfilVer` NULLABLE: los clientes existentes quedan en null.
--  * `perfiladoRechazado` con DEFAULT false: nadie arranca "rechazado".
--  * `perfiladoOmitidoEn` / `consentimientoPerfilEn` NULLABLE: sin backfill.
--  * `ConfiguracionClub.perfilDesdeVisita` con DEFAULT 3 (el umbral que pide el usuario).
--  * Indice (negocioId, fechaNacimiento): lo necesita el disparo de cumpleanos de la fase 2.
-- `fechaNacimiento` YA existia en `Cliente`: no se toca.
--
-- Generado con:
--   prisma migrate diff --from-schema-datasource ./prisma/schema.prisma \
--                       --to-schema-datamodel ./prisma/schema.prisma --script
-- (se descarto el `DROP TABLE "playing_with_neon"` que propone el diff, igual que en las
--  migraciones anteriores, y el `saldoJson` de `PremioOtorgado`, que tiene su propia migracion).

-- CreateEnum
CREATE TYPE "GeneroCliente" AS ENUM ('FEMENINO', 'MASCULINO', 'NO_BINARIO', 'OTRO', 'PREFIERO_NO_DECIR');

-- AlterTable
ALTER TABLE "Cliente" ADD COLUMN     "consentimientoPerfilEn" TIMESTAMP(3),
ADD COLUMN     "consentimientoPerfilVer" TEXT,
ADD COLUMN     "genero" "GeneroCliente",
ADD COLUMN     "perfiladoOmitidoEn" TIMESTAMP(3),
ADD COLUMN     "perfiladoRechazado" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ConfiguracionClub" ADD COLUMN     "perfilDesdeVisita" INTEGER NOT NULL DEFAULT 3;

-- CreateIndex
CREATE INDEX "Cliente_negocioId_fechaNacimiento_idx" ON "Cliente"("negocioId", "fechaNacimiento");
