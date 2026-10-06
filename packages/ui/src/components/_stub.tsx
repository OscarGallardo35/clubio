/**
 * STUB CON GUARD.
 *
 * Los componentes de @repo/ui que todavia no estan implementados se generan con
 * esto. Si alguno se renderiza, avisa por consola EN DEVELOPMENT en vez de
 * dejar la pantalla en blanco sin explicacion:
 *
 *   [@repo/ui] <Dialog> es un stub sin implementar y se renderizo (no muestra nada).
 *
 * En produccion es silencioso (solo devuelve null). El warning sale tambien en
 * el servidor, asi aparece en el build/SSR y no solo en el navegador.
 *
 * `process` se lee via globalThis con un tipo local: este package NO depende de
 * @types/node (es UI), asi que no se referencia `process` directo.
 */
const entorno = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process

export function crearStub(nombre: string) {
  const Stub = (_props: Record<string, unknown>) => {
    const enProduccion = entorno?.env?.NODE_ENV === 'production'
    if (!enProduccion) {
      // eslint-disable-next-line no-console
      console.warn(
        `[@repo/ui] <${nombre}> es un stub sin implementar y se renderizo (no muestra nada). ` +
          'Implementalo antes de usarlo en produccion.',
      )
    }
    return null
  }
  Stub.displayName = `${nombre}Stub`
  return Stub
}
