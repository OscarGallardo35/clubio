-- Historial de envios de push (una fila por envio x destinatario x endpoint) y
-- historial INMUTABLE de los disparos: `onDelete: SetNull` + snapshots de nombre.
--
-- Generado con:
--   prisma migrate diff --from-schema-datasource ./prisma/schema.prisma \
--                       --to-schema-datamodel ./prisma/schema.prisma --script
-- (se quito el `DROP TABLE "playing_with_neon"` que propone Neon y no es parte
-- del cambio).

-- DropForeignKey
ALTER TABLE "DisparoPushLog" DROP CONSTRAINT "DisparoPushLog_disparoId_fkey";

-- AlterTable
ALTER TABLE "DisparoPushLog" ADD COLUMN     "disparoNombre" TEXT,
ADD COLUMN     "plantillaNombre" TEXT,
ALTER COLUMN "disparoId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "EnvioPushLog" (
    "id" TEXT NOT NULL,
    "negocioId" TEXT NOT NULL,
    "campanaId" TEXT,
    "disparoId" TEXT,
    "clienteId" TEXT,
    "empleadoId" TEXT,
    "endpointId" TEXT,
    "estado" TEXT NOT NULL,
    "motivo" TEXT,
    "statusCode" INTEGER,
    "jobId" TEXT,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "campanaTitulo" TEXT,
    "disparoNombre" TEXT,
    "segmento" TEXT,
    "endpoint" TEXT,
    "error" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviadoEn" TIMESTAMP(3),

    CONSTRAINT "EnvioPushLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EnvioPushLog_negocioId_creadoEn_idx" ON "EnvioPushLog"("negocioId", "creadoEn");

-- CreateIndex
CREATE INDEX "EnvioPushLog_campanaId_estado_idx" ON "EnvioPushLog"("campanaId", "estado");

-- CreateIndex
CREATE INDEX "EnvioPushLog_disparoId_estado_idx" ON "EnvioPushLog"("disparoId", "estado");

-- CreateIndex
CREATE INDEX "EnvioPushLog_jobId_idx" ON "EnvioPushLog"("jobId");

-- AddForeignKey
ALTER TABLE "DisparoPushLog" ADD CONSTRAINT "DisparoPushLog_disparoId_fkey" FOREIGN KEY ("disparoId") REFERENCES "DisparoPush"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvioPushLog" ADD CONSTRAINT "EnvioPushLog_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "Negocio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvioPushLog" ADD CONSTRAINT "EnvioPushLog_campanaId_fkey" FOREIGN KEY ("campanaId") REFERENCES "CampanaMarketing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvioPushLog" ADD CONSTRAINT "EnvioPushLog_disparoId_fkey" FOREIGN KEY ("disparoId") REFERENCES "DisparoPush"("id") ON DELETE SET NULL ON UPDATE CASCADE;
