-- AlterTable
ALTER TABLE "TokenValidacion" ADD COLUMN     "sucursalId" TEXT;

-- CreateIndex
CREATE INDEX "TokenValidacion_negocioId_sucursalId_idx" ON "TokenValidacion"("negocioId", "sucursalId");

-- AddForeignKey
ALTER TABLE "TokenValidacion" ADD CONSTRAINT "TokenValidacion_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
