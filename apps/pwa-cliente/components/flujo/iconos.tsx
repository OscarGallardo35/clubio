/**
 * Iconos del flujo, en SVG inline y sin dependencias.
 *
 * lucide-react esta instalado en @repo/ui (y ahi se usa), pero no en la PWA: la
 * decision fue no duplicar la dependencia. Son 4 trazos, no vale un package.
 */

export function IconoReloj({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

export function IconoCheck({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

export function IconoAlerta({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4M12 16h.01" />
    </svg>
  )
}

export function IconoWhatsApp({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12.04 2C6.6 2 2.2 6.4 2.2 11.84c0 1.74.46 3.44 1.32 4.94L2 22l5.36-1.4c1.44.78 3.06 1.2 4.68 1.2 5.44 0 9.84-4.4 9.84-9.84S17.48 2 12.04 2Zm5.72 13.9c-.24.68-1.4 1.3-1.94 1.38-.5.08-1.1.11-1.76-.11-.4-.13-.92-.3-1.58-.59-2.78-1.2-4.6-4-4.74-4.19-.14-.19-1.13-1.5-1.13-2.86s.72-2.03.97-2.31c.25-.28.55-.35.73-.35.18 0 .37 0 .53.01.17.01.4-.06.62.48.23.55.79 1.91.86 2.05.07.14.12.3.02.49-.09.19-.14.3-.28.47-.14.16-.3.36-.42.48-.14.14-.29.29-.12.57.16.28.72 1.19 1.55 1.93 1.07.95 1.97 1.25 2.25 1.39.28.14.44.12.6-.07.16-.19.7-.81.88-1.09.19-.28.37-.23.62-.14.25.09 1.6.75 1.87.89.28.14.46.21.53.33.07.12.07.68-.17 1.36Z" />
    </svg>
  )
}
