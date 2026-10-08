import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

/**
 * Dashboard — placeholder de la Fase 2.
 *
 * La Fase 2 lo llena con `GET /estadisticas/dashboard` (hoy vs ayer, sellos, puntos, ticket
 * promedio y corte por sucursal) + las cuotas de `GET /planes/uso-mensual`. Aca va solo el
 * andamiaje, para que el layout tenga una pantalla que renderizar.
 */
export default function DashboardPage() {
  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Resumen del local</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Metricas</CardTitle>
          <CardDescription>Las metricas reales llegan en la Fase 2.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Sellos entregados, visitas, pedidos y la cuota del plan del mes.
        </CardContent>
      </Card>
    </section>
  );
}
