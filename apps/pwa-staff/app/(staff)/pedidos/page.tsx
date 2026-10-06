'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

/** Pedidos activos (QR #1). Placeholder: la Fase 3 los transiciona. */
export default function PedidosPage() {
  return (
    <main className="space-y-4 p-4">
      <h1 className="text-xl font-semibold">Pedidos</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Activos</CardTitle>
          <CardDescription>PENDIENTE a ENTREGADO, con aviso por WhatsApp.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Esta pantalla se implementa en la Fase 3 (pedidos + transiciones).
        </CardContent>
      </Card>
    </main>
  );
}
