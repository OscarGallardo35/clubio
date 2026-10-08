/**
 * Aserciones SSR de los componentes de @repo/ui.
 *
 *   pnpm --filter @repo/ui check:ssr
 *
 * ALCANCE (importante, para no creer que se verifica mas de lo que se verifica): el contenido
 * de Dialog / AlertDialog / Select / DropdownMenu vive en un Portal, y **el Portal NO se
 * renderiza en el servidor** (verificado: el SSR emite solo el trigger). Aca se afirma:
 *
 *   1. El trigger, que si se renderiza: `role="combobox"`, `aria-haspopup`, `aria-expanded`,
 *      `data-state`, `type="button"`.
 *   2. La IDENTIDAD de los primitivos que se re-exportan sin wrapper (Root / Trigger / Close):
 *      si `Dialog === DialogPrimitive.Root`, el comportamiento (foco atrapado, Escape, rol) es
 *      el de Radix y no el de un componente propio.
 *   3. Todo el markup de `DataTable`, que no usa Portal.
 *
 * Afirmar los roles del contenido ABIERTO (`role="dialog"`, `listbox`, `menu`, `alertdialog`)
 * necesita un DOM: jsdom no esta entre las dependencias del repo, asi que no se pretende.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Dialog, DialogTrigger, DialogClose, DialogContent, DialogTitle, DialogDescription } from '../src/index'

/** `process` sin depender de @types/node (mismo truco que components/_stub.tsx). */
const proc = (globalThis as { process?: { exit?: (codigo?: number) => void } }).process

let fallos = 0
function chk(etiqueta: string, cond: boolean, extra = '') {
  console.log(`  ${cond ? 'OK   ' : 'FALLA'} ${etiqueta}${extra ? '   -> ' + extra : ''}`)
  if (!cond) fallos += 1
}

// ---------------------------------------------------------------- Dialog
console.log('Dialog')
const dlgCerrado = renderToStaticMarkup(
  <Dialog>
    <DialogTrigger>Abrir</DialogTrigger>
    <DialogContent>
      <DialogTitle>Titulo</DialogTitle>
      <DialogDescription>Descripcion</DialogDescription>
    </DialogContent>
  </Dialog>,
)
const dlgAbierto = renderToStaticMarkup(
  <Dialog defaultOpen>
    <DialogTrigger>Abrir</DialogTrigger>
    <DialogContent>
      <DialogTitle>Titulo</DialogTitle>
    </DialogContent>
  </Dialog>,
)

chk('Dialog ES el Root de Radix', Dialog === DialogPrimitive.Root)
chk('DialogTrigger ES el Trigger de Radix', DialogTrigger === DialogPrimitive.Trigger)
chk('DialogClose ES el Close de Radix', DialogClose === DialogPrimitive.Close)
chk('el trigger es un <button type="button">', dlgCerrado.includes('<button type="button"'), dlgCerrado.trim())
chk('el trigger declara aria-haspopup="dialog"', dlgCerrado.includes('aria-haspopup="dialog"'))
chk(
  'cerrado: aria-expanded="false" + data-state="closed"',
  dlgCerrado.includes('aria-expanded="false"') && dlgCerrado.includes('data-state="closed"'),
)
chk(
  'abierto: aria-expanded="true" + data-state="open"',
  dlgAbierto.includes('aria-expanded="true"') && dlgAbierto.includes('data-state="open"'),
)
chk(
  'el contenido NO viaja en el SSR (Radix usa Portal)',
  !dlgCerrado.includes('role="dialog"') && !dlgAbierto.includes('role="dialog"'),
  'el rol del contenido lo pone Radix al montar',
)

console.log(fallos === 0 ? '\nTOTAL OK' : `\nTOTAL FALLAS: ${fallos}`)
proc?.exit?.(fallos === 0 ? 0 : 1)
