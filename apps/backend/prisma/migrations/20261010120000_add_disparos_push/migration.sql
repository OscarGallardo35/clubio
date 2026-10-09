-- CreateEnum
CREATE TYPE "TipoDisparo" AS ENUM ('COMPRA', 'SELLOS', 'DIA', 'INACTIVIDAD', 'BIENVENIDA', 'MANUAL');

-- CreateTable
CREATE TABLE "DisparoPush" (
    "id" TEXT NOT NULL,
    "negocioId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "tipo" "TipoDisparo" NOT NULL,
    "config" JSONB NOT NULL,
    "plantillaId" TEXT NOT NULL,
    "regalo" JSONB,
    "limitePorCliente" JSONB,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisparoPush_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisparoPushLog" (
    "id" TEXT NOT NULL,
    "disparoId" TEXT NOT NULL,
    "negocioId" TEXT NOT NULL,
    "clienteId" TEXT,
    "pedidoId" TEXT,
    "tipo" "TipoDisparo" NOT NULL,
    "clave" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "sellosAcreditados" INTEGER NOT NULL DEFAULT 0,
    "puntosAcreditados" INTEGER NOT NULL DEFAULT 0,
    "detalle" JSONB,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisparoPushLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DisparoPush_negocioId_tipo_activa_idx" ON "DisparoPush"("negocioId", "tipo", "activa");

-- CreateIndex
CREATE INDEX "DisparoPushLog_disparoId_clienteId_creadoEn_idx" ON "DisparoPushLog"("disparoId", "clienteId", "creadoEn");

-- CreateIndex
CREATE INDEX "DisparoPushLog_negocioId_creadoEn_idx" ON "DisparoPushLog"("negocioId", "creadoEn");

-- CreateIndex
CREATE UNIQUE INDEX "DisparoPushLog_disparoId_clave_key" ON "DisparoPushLog"("disparoId", "clave");

-- CreateIndex
CREATE UNIQUE INDEX "DisparoPushLog_disparoId_clienteId_pedidoId_key" ON "DisparoPushLog"("disparoId", "clienteId", "pedidoId");

-- AddForeignKey
ALTER TABLE "DisparoPush" ADD CONSTRAINT "DisparoPush_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "Negocio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisparoPush" ADD CONSTRAINT "DisparoPush_plantillaId_fkey" FOREIGN KEY ("plantillaId") REFERENCES "PlantillaPush"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisparoPushLog" ADD CONSTRAINT "DisparoPushLog_disparoId_fkey" FOREIGN KEY ("disparoId") REFERENCES "DisparoPush"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- NOTA: `migrate diff` tambien propuso `DROP TABLE "playing_with_neon"` (una tabla de
-- bienvenida de Neon, fuera del schema). Se omite a proposito.
