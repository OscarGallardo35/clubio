-- CreateTable
CREATE TABLE "PlantillaPush" (
    "id" TEXT NOT NULL,
    "negocioId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "cuerpo" TEXT NOT NULL,
    "icono" TEXT,
    "url" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlantillaPush_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlantillaPush_negocioId_activa_idx" ON "PlantillaPush"("negocioId", "activa");

-- AddForeignKey
ALTER TABLE "PlantillaPush" ADD CONSTRAINT "PlantillaPush_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "Negocio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
