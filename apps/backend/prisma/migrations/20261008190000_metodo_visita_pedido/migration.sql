-- AlterEnum
-- El pedido digital (QR #1) acredita al pasar a ENTREGADO: necesita su propio metodo.
ALTER TYPE "MetodoVisita" ADD VALUE IF NOT EXISTS 'PEDIDO';
