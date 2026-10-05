-- AlterTable
ALTER TABLE "Cliente" ADD COLUMN     "eliminadoEn" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Cliente_negocioId_eliminadoEn_idx" ON "Cliente"("negocioId", "eliminadoEn");
