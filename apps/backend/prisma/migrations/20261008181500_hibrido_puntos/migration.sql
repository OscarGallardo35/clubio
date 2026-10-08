-- AlterTable
ALTER TABLE "Cliente" ADD COLUMN     "ultimoCanjeEn" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ConfiguracionClub" ADD COLUMN     "premioTextoPuntos" TEXT DEFAULT 'Postre gratis',
ADD COLUMN     "puntosPorMil" INTEGER DEFAULT 5;
