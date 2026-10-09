-- AlterTable
ALTER TABLE "Cliente" ADD COLUMN "tokenVerificacion" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_tokenVerificacion_key" ON "Cliente"("tokenVerificacion");
