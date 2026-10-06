/**
 * Harness SSR de los componentes de formulario de @repo/ui.
 *
 * POR QUE ES INTEGRATION TEST Y NO UNIT: los componentes son .tsx y Node no
 * transpila JSX, y el `dist` de @repo/ui es ESM con imports sin extension
 * (`ERR_MODULE_NOT_FOUND`). Un test unitario necesitaria un bundler como
 * dependencia nueva. Entonces se pega a /dev/ui de la PWA Cliente, donde Next ya
 * renderiza los componentes en el SERVIDOR, y se asserta sobre el HTML servido.
 *
 * Requiere: dev server de la PWA Cliente vivo en :3001 (igual que check:flujo-ws
 * requiere el backend en :3000).
 *
 *   node scripts/check-ui-ssr.mts
 */
const URL_UI = process.env.UI_URL ?? 'http://localhost:3001/dev/ui';

let ok = 0;
const fallas: string[] = [];

function chk(nombre: string, cond: boolean, extra = '') {
  if (cond) ok++;
  else fallas.push(extra ? `${nombre} -> ${extra}` : nombre);
}

let html = '';
try {
  const res = await fetch(URL_UI);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  html = await res.text();
} catch (e) {
  console.error(`\n  No se pudo leer ${URL_UI}: ${e instanceof Error ? e.message : e}`);
  console.error('  Levanta la PWA Cliente (pnpm --filter pwa-cliente dev, :3001) y reintenta.');
  process.exit(1);
}

chk('el HTML se sirvio', html.length > 1000, `${html.length} bytes`);

// RadioGroup: los roles los emite Radix, no los escribimos a mano.
chk('RadioGroup emite role="radiogroup"', html.includes('role="radiogroup"'));
chk('cada opcion emite role="radio"', html.includes('role="radio"'));
// Checkbox: Radix renderiza un button[role=checkbox] y mantiene sincronizado un
// input[type=checkbox] nativo (el que usan los formularios).
chk('Checkbox deja un input[type="checkbox"]', html.includes('type="checkbox"'));
// Textarea: el control nativo. OJO: no lleva role="textbox" explicito porque el
// elemento ya tiene ese rol implicito; assertar el atributo seria assertar algo
// que no existe (y forzarlo seria redundante).
chk('Textarea renderiza un <textarea> nativo', html.includes('<textarea'));
chk('el Textarea tiene el estilo del sistema (min-h-28), no el stub pelado', html.includes('min-h-28'));
chk('Switch emite role="switch"', html.includes('role="switch"'));
// data-state es la senal de Radix: si los componentes fueran los stubs viejos no
// existiria en el HTML.
chk('Radix marca data-state', /data-state="(checked|unchecked|off|on)"/.test(html));
// El stub pelado renderizaba un input sin clases: si eso volviera, el radio no
// tendria el area tactil ampliada.
chk('el control tiene el area tactil ampliada (after:-inset-3)', html.includes('after:-inset-3'));

console.log(`\n  ${fallas.length === 0 ? 'TODO OK' : 'HAY FALLAS'}: ${ok} aserciones OK, ${fallas.length} fallas`);
for (const f of fallas) console.log(`   FALLA ${f}`);
process.exit(fallas.length === 0 ? 0 : 1);
