#!/usr/bin/env node
/**
 * Checklist ejecutable de cobertura multi-sucursal (#2.11).
 *
 *   pnpm --filter backend test:checklist
 *
 * Recorre los modulos del backend y reporta, por modulo:
 *   - RESOLVER: resuelve la sucursal con SucursalResolverService
 *   - FILTRO:   filtra queries por sucursalId
 *   - WS:       los gateways emiten a salas por sucursal (no broadcast)
 *   - hardcode: no hay sucursales hardcodeadas en las queries
 *
 * Exit code 1 si algun modulo declarado en EXPECT falla. Los modulos marcados
 * como "no aplica" se informan como n/a (con el motivo), no como fallo.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

/** que se espera de cada modulo */
const EXPECT = [
  { dir: 'visitas',       resolver: true,  filtro: true,  ws: 'visitas/visitas.gateway.ts' },
  { dir: 'pedidos',       resolver: true,  filtro: true,  ws: 'pedidos/pedidos.gateway.ts' },
  { dir: 'turnos',        resolver: true,  filtro: true,  ws: null },
  { dir: 'clientes',      resolver: true,  filtro: true,  ws: null },
  { dir: 'carta',         resolver: true,  filtro: true,  ws: null },
  { dir: 'configuracion', resolver: true,  filtro: true,  ws: null },
  { dir: 'upsell',        resolver: true,  filtro: true,  ws: null },
  { dir: 'sucursales',    resolver: true,  filtro: true,  ws: null },
  { dir: 'negocios',      resolver: true,  filtro: false, ws: null },
  { dir: 'auth',          resolver: true,  filtro: false, ws: null },
  { dir: 'empleados',     resolver: false, filtro: true,  ws: null,
    nota: 'un empleado PERTENECE a una sucursal: su sucursalId ES el dato' },
  { dir: 'push',          resolver: false, filtro: true,  ws: null,
    nota: 'recibe la sucursal por parametro' },
  { dir: 'estadisticas',  resolver: false, filtro: true,  ws: null },
  { dir: 'modificadores', resolver: false, filtro: false, ws: null,
    nota: 'sin dimension de sucursal por diseno (#2.7)' },
  { dir: 'resenas',       resolver: false, filtro: false, ws: null,
    nota: 'por negocio (Google Business Profile)' },
  { dir: 'webhooks',      resolver: false, filtro: false, ws: null,
    nota: 'eventos externos, sin sucursal' },
];

function archivos(dir) {
  const abs = path.join(SRC, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { recursive: true })
    .map((f) => String(f))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ rel: `${dir}/${f}`, txt: fs.readFileSync(path.join(abs, f), 'utf8') }));
}

/** Busca ids/slugs de sucursal escritos a mano en una query. */
const HARDCODE = [
  /sucursalId:\s*'(centro|norte|principal|sucursal-\d)'/i,
  /sucursalSlug:\s*'(?!dto\.|qs\.|query)[a-z-]+'(?!\s*\))/,
  /slug:\s*'(centro|norte)'/,
];

function evaluar(spec) {
  const files = archivos(spec.dir);
  const problemas = [];
  if (!files.length) return { ...spec, estado: 'n/a', problemas: ['modulo sin archivos .ts'] };

  const todo = files.map((f) => f.txt).join('\n');

  const usaResolver = /resolverSucursal|resolverSucursalDeEmpleado|resolverSucursalDePedido|resolverNumeroAtendiente/.test(todo);
  const filtra = /sucursalId/.test(todo);
  const pidioResolver = spec.resolver;
  const pidioFiltro = spec.filtro;

  if (pidioResolver && !usaResolver) problemas.push('no usa SucursalResolverService');
  if (pidioFiltro && !filtra) problemas.push('no filtra por sucursalId');

  // WS: el gateway tiene que emitir a la sala de la sucursal y no hacer broadcast
  if (spec.ws) {
    const gw = files.find((f) => f.rel === spec.ws);
    if (!gw) problemas.push(`falta el gateway ${spec.ws}`);
    else {
      if (!/salaSucursal\(/.test(gw.txt)) problemas.push(`${spec.ws}: no usa salaSucursal()`);
      const broadcasts = (gw.txt.match(/this\.server\.emit\(/g) || []).length;
      if (broadcasts) problemas.push(`${spec.ws}: ${broadcasts} broadcast(s) sin sala`);
    }
  }

  // hardcode
  const hard = [];
  for (const f of files) {
    for (const re of HARDCODE) {
      const m = f.txt.match(re);
      if (m && !/\/\//.test(f.txt.slice(Math.max(0, f.txt.indexOf(m[0]) - 60), f.txt.indexOf(m[0])))) {
        hard.push(`${f.rel}: ${m[0].trim().slice(0, 48)}`);
      }
    }
  }
  // los archivos de test/scripts no cuentan
  const hard2 = hard.filter((h) => !/\.spec\.|\.e2e\.|scripts\//.test(h));
  if (hard2.length) problemas.push(`hardcode: ${hard2.slice(0, 2).join(' | ')}`);

  return {
    ...spec,
    estado: problemas.length ? 'FALLA' : 'OK',
    resolver: usaResolver, filtro: filtra, problemas,
  };
}

const filas = EXPECT.map(evaluar);
const ancho = Math.max(...filas.map((f) => f.dir.length), 6);

console.log('\nCHECKLIST MULTI-SUCURSAL (#2.11)\n');
console.log(
  '  ' + 'MODULO'.padEnd(ancho) + '  ESTADO  RESOLVER  FILTRO   NOTA',
);
console.log('  ' + '-'.repeat(ancho + 40));
let fallas = 0;
for (const f of filas) {
  if (f.estado === 'FALLA') fallas++;
  const nota = f.estado === 'OK'
    ? (f.nota ?? '')
    : f.problemas.join('; ');
  console.log(
    '  ' + f.dir.padEnd(ancho) + '  ' + f.estado.padEnd(6) + '  ' +
    (f.estado === 'n/a' ? '-' : (f.resolver ? 'si' : 'no')).padEnd(8) + '  ' +
    (f.estado === 'n/a' ? '-' : (f.filtro ? 'si' : 'no')).padEnd(7) + '  ' + nota,
  );
}
console.log('  ' + '-'.repeat(ancho + 40));
console.log(`  ${filas.length} modulo(s) | ${filas.filter((f) => f.estado === 'OK').length} OK | ` +
  `${filas.filter((f) => f.estado === 'n/a').length} n/a | ${fallas} con fallas`);

console.log(`
  ALCANCE (leer antes de confiar en el resultado):
  Esto es un chequeo ESTRUCTURAL estatico: verifica que el resolver se use, que
  las queries filtren por sucursalId, que los gateways emitan a salas de sucursal
  y que no haya sucursales hardcodeadas. NO prueba comportamiento.
  Un "16/16 OK" NO significa que multi-sucursal este bien: la logica de sellos
  GLOBAL vs POR_SUCURSAL tenia un bug real que este script no puede ver.
  Para comportamiento: los e2e de visitas (sellos), pedidos y turnos.
`);


process.exit(fallas ? 1 : 0);
