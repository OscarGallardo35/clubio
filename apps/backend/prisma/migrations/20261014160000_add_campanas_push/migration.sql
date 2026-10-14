-- Campanas de push PROGRAMABLES (`CampanaPush`) + el enganche de VENTANA HORARIA
-- de despacho en `ConfiguracionClub` (`pushVentanaInicio`/`pushVentanaFin`, 'HH:mm' AR).
--
-- Generado con:
--   prisma migrate diff --from-schema-datasource ./prisma/schema.prisma \
--                       --to-schema-datamodel ./prisma/schema.prisma --script
-- (se quito el `DROP TABLE "playing_with_neon"` que propone Neon y no es parte
-- del cambio).

-- CreateEnum
CREATE TYPE "EstadoCampanaPush" AS ENUM ('PROGRAMADA', 'ENVIANDO', 'ENVIADA', 'CANCELADA');

-- AlterTable
ALTER TABLE "ConfiguracionClub" ADD COLUMN     "pushVentanaFin" TEXT,
ADD COLUMN     "pushVentanaInicio" TEXT;

-- CreateTable
CREATE TABLE "CampanaPush" (
    "id" TEXT NOT NULL,
    "negocioId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "cuerpo" TEXT NOT NULL,
    "url" TEXT,
    "icono" TEXT,
    "plantillaId" TEXT,
    "segmento" TEXT NOT NULL DEFAULT 'TODOS',
    "exclusiones" JSONB,
    "programadoPara" TIMESTAMP(3) NOT NULL,
    "estado" "EstadoCampanaPush" NOT NULL DEFAULT 'PROGRAMADA',
    "campanaId" TEXT,
    "enviadaEn" TIMESTAMP(3),
    "motivoCancelacion" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampanaPush_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CampanaPush_campanaId_key" ON "CampanaPush"("campanaId");

-- CreateIndex
CREATE INDEX "CampanaPush_negocioId_estado_programadoPara_idx" ON "CampanaPush"("negocioId", "estado", "programadoPara");

-- CreateIndex
CREATE INDEX "CampanaPush_estado_programadoPara_idx" ON "CampanaPush"("estado", "programadoPara");

-- AddForeignKey
ALTER TABLE "CampanaPush" ADD CONSTRAINT "CampanaPush_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "Negocio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampanaPush" ADD CONSTRAINT "CampanaPush_plantillaId_fkey" FOREIGN KEY ("plantillaId") REFERENCES "PlantillaPush"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampanaPush" ADD CONSTRAINT "CampanaPush_campanaId_fkey" FOREIGN KEY ("campanaId") REFERENCES "CampanaMarketing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
