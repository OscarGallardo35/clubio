/**
 * Landing de respaldo: se ve si alguien entra al dominio sin haber escaneado un
 * QR. El flujo real entra por /[tenant]/menu o /[tenant]/club.
 */
export default function Inicio() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-bold">Escanea el QR del local</h1>
      <p className="text-muted-foreground">
        Pedi el QR de la carta o del club al personal para ver el menu o sumar tu visita.
      </p>
    </main>
  );
}
