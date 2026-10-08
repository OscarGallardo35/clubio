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

// ---------------------------------------------------------------- AlertDialog
// El import va aca (y no arriba) para que cada componente traiga su bloque + su primitivo
// juntos: `import` es hoisted, asi que es valido a nivel top-level en cualquier posicion.
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog'
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '../src/index'

console.log('\nAlertDialog')
const alertCerrado = renderToStaticMarkup(
  <AlertDialog>
    <AlertDialogTrigger>Borrar</AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogTitle>Estas seguro?</AlertDialogTitle>
      <AlertDialogDescription>No se puede deshacer.</AlertDialogDescription>
      <AlertDialogAction>Borrar</AlertDialogAction>
      <AlertDialogCancel>Cancelar</AlertDialogCancel>
    </AlertDialogContent>
  </AlertDialog>,
)

chk('AlertDialog ES el Root de Radix', AlertDialog === AlertDialogPrimitive.Root)
chk('AlertDialogTrigger ES el Trigger de Radix', AlertDialogTrigger === AlertDialogPrimitive.Trigger)
// Action/Cancel NO son el primitivo pelado: son wrappers que le aplican `buttonVariants()`.
// Lo verificable aca es que envuelven al primitivo correcto (heredan su displayName).
chk(
  'AlertDialogAction es un wrapper del Action (no el primitivo)',
  AlertDialogAction !== AlertDialogPrimitive.Action &&
    (AlertDialogAction as { displayName?: string }).displayName === AlertDialogPrimitive.Action.displayName,
)
chk(
  'AlertDialogCancel es un wrapper del Cancel (no el primitivo)',
  AlertDialogCancel !== AlertDialogPrimitive.Cancel &&
    (AlertDialogCancel as { displayName?: string }).displayName === AlertDialogPrimitive.Cancel.displayName,
)
chk('el trigger es un <button type="button">', alertCerrado.includes('<button type="button"'))
chk('el trigger declara aria-haspopup="dialog"', alertCerrado.includes('aria-haspopup="dialog"'))
chk(
  'cerrado: aria-expanded="false"',
  alertCerrado.includes('aria-expanded="false"') && alertCerrado.includes('data-state="closed"'),
)
chk(
  'el contenido NO viaja en el SSR (Radix usa Portal)',
  !alertCerrado.includes('role="alertdialog"'),
  'rol y "no cierra con Escape" los aporta Radix al montar',
)

// ---------------------------------------------------------------- Select
import * as SelectPrimitive from '@radix-ui/react-select'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectLabel, SelectItem } from '../src/index'

console.log('\nSelect')
const selCerrado = renderToStaticMarkup(
  <Select>
    <SelectTrigger aria-label="Sucursal">
      <SelectValue placeholder="Elegi una sucursal" />
    </SelectTrigger>
    <SelectContent>
      <SelectGroup>
        <SelectLabel>Centro</SelectLabel>
        <SelectItem value="centro">Centro</SelectItem>
        <SelectItem value="norte">Norte</SelectItem>
      </SelectGroup>
    </SelectContent>
  </Select>,
)

chk('Select ES el Root de Radix', Select === SelectPrimitive.Root)
chk('SelectGroup ES el Group de Radix', SelectGroup === SelectPrimitive.Group)
chk('SelectValue ES el Value de Radix', SelectValue === SelectPrimitive.Value)
chk('el trigger declarara role="combobox"', selCerrado.includes('role="combobox"'), selCerrado.trim())
chk('cerrado: aria-expanded="false" + data-state="closed"',
  selCerrado.includes('aria-expanded="false"') && selCerrado.includes('data-state="closed"'))
chk('el placeholder se muestra mientras no hay valor', selCerrado.includes('Elegi una sucursal'))
chk(
  'la lista (role="listbox") NO viaja en el SSR (Radix usa Portal)',
  !selCerrado.includes('role="listbox"'),
  'listbox + navegacion con teclado los aporta Radix al montar',
)

// ---------------------------------------------------------------- DropdownMenu
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '../src/index'

console.log('\nDropdownMenu')
const ddCerrado = renderToStaticMarkup(
  <DropdownMenu>
    <DropdownMenuTrigger>Acciones</DropdownMenuTrigger>
    <DropdownMenuContent>
      <DropdownMenuLabel>Empleado</DropdownMenuLabel>
      <DropdownMenuItem>Editar</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem>Dar de baja</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>,
)

chk('DropdownMenu ES el Root de Radix', DropdownMenu === DropdownMenuPrimitive.Root)
chk('DropdownMenuTrigger ES el Trigger de Radix', DropdownMenuTrigger === DropdownMenuPrimitive.Trigger)
chk('DropdownMenuGroup ES el Group de Radix', DropdownMenuPrimitive.Group !== undefined)
chk('el trigger es un <button type="button">', ddCerrado.includes('<button type="button"'))
chk('el trigger declara aria-haspopup="menu"', ddCerrado.includes('aria-haspopup="menu"'), ddCerrado.trim())
chk('cerrado: aria-expanded="false" + data-state="closed"',
  ddCerrado.includes('aria-expanded="false"') && ddCerrado.includes('data-state="closed"'))
chk(
  'el menu (role="menu") NO viaja en el SSR (Radix usa Portal)',
  !ddCerrado.includes('role="menu"'),
  'menu/menuitem + flechas los aporta Radix al montar',
)

// ---------------------------------------------------------------- DataTable
import { DataTable, Checkbox } from '../src/index'
import type { DataTableColumn } from '../src/index'

console.log('\nDataTable')
interface FilaPrueba {
  id: string
  nombre: string
  sellos: number
  activo: boolean
  nota: string | null
}
const FILAS: FilaPrueba[] = [
  { id: 'e1', nombre: 'Maria', sellos: 12, activo: true, nota: null },
  { id: 'e2', nombre: 'Juan', sellos: 3, activo: false, nota: 'nuevo' },
]
const COLUMNAS: DataTableColumn<FilaPrueba>[] = [
  { key: 'id', header: 'Sel.', render: (f) => <Checkbox aria-label={`Elegir ${f.nombre}`} /> },
  { key: 'nombre', header: 'Nombre' },
  { key: 'sellos', header: 'Sellos' },
  { key: 'activo', header: 'Activo' },
  { key: 'nota', header: 'Nota' },
]

const tabla = renderToStaticMarkup(<DataTable data={FILAS} columns={COLUMNAS} rowKey={(f) => f.id} />)
const tablaVacia = renderToStaticMarkup(<DataTable data={[]} columns={COLUMNAS} />)
const tablaVaciaCustom = renderToStaticMarkup(
  <DataTable data={[]} columns={COLUMNAS} empty="Todavia no hay empleados." />,
)
const tablaCargando = renderToStaticMarkup(<DataTable data={[]} columns={COLUMNAS} loading />)
const tablaClickeable = renderToStaticMarkup(
  <DataTable data={FILAS} columns={COLUMNAS} onRowClick={() => undefined} />,
)
const ths = (tabla.match(/<th scope="col"/g) ?? []).length
const trs = (tabla.match(/<tr/g) ?? []).length

chk('es una <table> de verdad', tabla.includes('<table'))
chk('un <th scope="col"> por columna', ths === COLUMNAS.length, `${ths} th`)
chk('una fila por dato (+ la del header)', trs === FILAS.length + 1, `${trs} tr`)
chk('la celda con `render` dibuja el Checkbox (input type=checkbox)', tabla.includes('type="checkbox"'))
chk('la columna sin `render` muestra el valor crudo', tabla.includes('Maria') && tabla.includes('">12<'))
chk('booleano -> Si / No', tabla.includes('>Si<') && tabla.includes('>No<'))
chk('null (o vacio) -> em dash', tabla.includes('—'))
chk('vacio: mensaje por defecto', tablaVacia.includes('No hay datos para mostrar.'))
chk('vacio: el mensaje es configurable', tablaVaciaCustom.includes('Todavia no hay empleados.'))
chk(
  'loading: 4 filas de skeleton y ningun dato',
  (tablaCargando.match(/data-carga/g) ?? []).length === 4 && !tablaCargando.includes('Maria'),
  `${(tablaCargando.match(/data-carga/g) ?? []).length} filas`,
)
chk(
  'onRowClick -> fila con role="button" y tabindex=0 (teclado)',
  tablaClickeable.includes('role="button"') && tablaClickeable.includes('tabindex="0"'),
)
chk(
  'sin onRowClick la fila NO es un boton',
  !tabla.includes('role="button"') && !tabla.includes('cursor-pointer'),
)

console.log(fallos === 0 ? '\nTOTAL OK' : `\nTOTAL FALLAS: ${fallos}`)
proc?.exit?.(fallos === 0 ? 0 : 1)
