-- Par antes/despues del saldo del cliente en la ACEPTACION del premio (`PremioOtorgado.saldoJson`).
--
-- Por que: la modal del premio muestra "antes -> despues" y el GET publico tiene que devolver el
-- MISMO par al recargar la pagina. El saldo ACTUAL no sirve para reconstruirlo (despues de aceptar
-- pueden venir mas visitas/premios), asi que se persiste el par que se leyo al acreditar.
--
-- Columna NULLABLE: no rompe ninguna fila existente y los premios viejos responden con el saldo
-- actual (antes == despues) en vez de fallar.
--
-- Generado con:
--   prisma migrate diff --from-schema-datasource ./prisma/schema.prisma \
--                       --to-schema-datamodel ./prisma/schema.prisma --script

-- AlterTable
ALTER TABLE "PremioOtorgado" ADD COLUMN "saldoJson" JSONB;
