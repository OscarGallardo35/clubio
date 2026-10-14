-- Horarios de atencion y de delivery (grilla semanal JSON) + excepciones por fecha.
--
-- Aditivo: dos columnas JSONB nullable en ConfiguracionClub y ConfiguracionSucursal
-- (NULL = sin horarios = siempre abierto, no rompe a los tenants existentes) y una
-- tabla chica para feriados / cierres temporales.
--
-- NOTA: el `migrate diff` tambien propuso `DROP TABLE "playing_with_neon"` (una tabla
-- de prueba del proveedor que existe en la DB y no en el schema). Se OMITE a proposito:
-- no es parte de este cambio.

-- AlterTable
ALTER TABLE "ConfiguracionClub" ADD COLUMN     "horariosAtencion" JSONB,
ADD COLUMN     "horariosDelivery" JSONB;

-- AlterTable
ALTER TABLE "ConfiguracionSucursal" ADD COLUMN     "horariosAtencion" JSONB,
ADD COLUMN     "horariosDelivery" JSONB;

-- CreateTable
CREATE TABLE "ExcepcionHorario" (
    "id" TEXT NOT NULL,
    "negocioId" TEXT NOT NULL,
    "sucursalId" TEXT,
    "desdeFecha" DATE NOT NULL,
    "hastaFecha" DATE NOT NULL,
    "motivo" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExcepcionHorario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExcepcionHorario_negocioId_sucursalId_desdeFecha_hastaFecha_idx" ON "ExcepcionHorario"("negocioId", "sucursalId", "desdeFecha", "hastaFecha");

-- AddForeignKey
ALTER TABLE "ExcepcionHorario" ADD CONSTRAINT "ExcepcionHorario_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "Negocio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExcepcionHorario" ADD CONSTRAINT "ExcepcionHorario_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
