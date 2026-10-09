-- Fase 1: vinculo visita -> pedido del menu (QR #1).
-- Nullable y con UNIQUE: un pedido solo puede pagar UNA visita, si no la acreditacion
-- se duplica (el pedido ENTREGADO acredita por su lado).
ALTER TABLE "Visita" ADD COLUMN "pedidoId" TEXT;

CREATE UNIQUE INDEX "Visita_pedidoId_key" ON "Visita"("pedidoId");

ALTER TABLE "Visita" ADD CONSTRAINT "Visita_pedidoId_fkey"
  FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE SET NULL ON UPDATE CASCADE;
