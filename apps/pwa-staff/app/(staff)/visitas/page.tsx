'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

/** Visitas pendientes (QR #2). Placeholder: la Fase 2 cierra el loop sin curl. */
export default function VisitasPage() {
  return (
    <main className="space-y-4 p-4">
      <h1 className="text-xl font-semibold">Visitas</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pendientes de aprobacion</CardTitle>
          <CardDescription>Aprobar o rechazar con motivo.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Esta pantalla se implementa en la Fase 2 (visitas + WS visita:aprobada).
        </CardContent>
      </Card>
    </main>
  );
}
