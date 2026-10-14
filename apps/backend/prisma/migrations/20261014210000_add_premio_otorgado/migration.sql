-- PREMIOS que el cliente ACEPTA desde la notificacion (`PremioOtorgado`) + el
-- descriptor `premio` en `DisparoPush` y `CampanaPush`.
--
-- Generado con:
--   prisma migrate diff --from-schema-datasource ./prisma/schema.prisma \
--                       --to-schema-datamodel ./prisma/schema.prisma --script
-- (se quito el `DROP TABLE "playing_with_neon"` que propone Neon y no es parte
-- del cambio).

-- CreateEnum
CREATE TYPE "TipoPremio" AS ENUM ('SELLOS', 'PUNTOS', 'LIBRE');

-- CreateEnum
CREATE TYPE "EstadoPremio" AS ENUM ('PENDIENTE', 'ACEPTADO', 'CANJEADO', 'VENCIDO');

-- AlterTable
ALTER TABLE "CampanaPush" ADD COLUMN     "premio" JSONB;

-- AlterTable
ALTER TABLE "DisparoPush" ADD COLUMN     "premio" JSONB;

-- CreateTable
CREATE TABLE "PremioOtorgado" (
    "id" TEXT NOT NULL,
    "negocioId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "tipo" "TipoPremio" NOT NULL,
    "cantidad" INTEGER NOT NULL DEFAULT 0,
    "texto" TEXT NOT NULL,
    "campanaNombre" TEXT,
    "disparoNombre" TEXT,
    "token" TEXT NOT NULL,
    "estado" "EstadoPremio" NOT NULL DEFAULT 'PENDIENTE',
    "expiraEn" TIMESTAMP(3),
    "aceptadoEn" TIMESTAMP(3),
    "canjeadoEn" TIMESTAMP(3),
    "disparoId" TEXT,
    "campanaId" TEXT,
    "sucursalId" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PremioOtorgado_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PremioOtorgado_token_key" ON "PremioOtorgado"("token");

-- CreateIndex
CREATE INDEX "PremioOtorgado_negocioId_estado_idx" ON "PremioOtorgado"("negocioId", "estado");

-- CreateIndex
CREATE INDEX "PremioOtorgado_negocioId_clienteId_estado_idx" ON "PremioOtorgado"("negocioId", "clienteId", "estado");

-- CreateIndex
CREATE INDEX "PremioOtorgado_token_idx" ON "PremioOtorgado"("token");

-- AddForeignKey
ALTER TABLE "PremioOtorgado" ADD CONSTRAINT "PremioOtorgado_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "Negocio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PremioOtorgado" ADD CONSTRAINT "PremioOtorgado_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PremioOtorgado" ADD CONSTRAINT "PremioOtorgado_disparoId_fkey" FOREIGN KEY ("disparoId") REFERENCES "DisparoPush"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PremioOtorgado" ADD CONSTRAINT "PremioOtorgado_campanaId_fkey" FOREIGN KEY ("campanaId") REFERENCES "CampanaPush"("id") ON DELETE SET NULL ON UPDATE CASCADE;

