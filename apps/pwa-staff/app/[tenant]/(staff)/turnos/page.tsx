'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';
import { useEmpleado } from '@/hooks/useEmpleado';

/** Dashboard de turnos. Placeholder de la Fase 1: la Fase 4 lo llena. */
export default function TurnosPage() {
  const { empleado, sucursal } = useEmpleado();

  return (
    <main className="space-y-4 p-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Hola, {empleado?.nombre ?? 'equipo'}</h1>
        <p className="text-sm text-muted-foreground">
          {sucursal ? `Sucursal ${sucursal.nombre}` : 'Sin sucursal asignada'}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Turnos de hoy</CardTitle>
          <CardDescription>Proximamente: check-in y turnos del dia.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Esta pantalla se implementa en la Fase 4 (turnos + check-in + presentes).
        </CardContent>
      </Card>
    </main>
  );
}
