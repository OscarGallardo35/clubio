/**
 * Aislamiento del CRUD de modificadores (#2.7): una opcion solo se puede actualizar
 * desde SU grupo.
 *
 * Vigila el IDOR de escritura que tenia `actualizarGrupo`: el grupo SI se validaba contra
 * `negocioId`, pero las opciones que llegan con `id` no, asi que un id de otro grupo (o de
 * otro NEGOCIO) se actualizaba igual. Sus hermanos (`eliminarOpcion`, `reordenarOpciones`)
 * ya lo validaban; faltaba aca.
 *
 * Es un harness de INTEGRACION: pega a la API real, crea DOS grupos y los borra al final
 * (incluso si una asercion falla). La asercion que importa es la 2: con el bug devuelve 200
 * y MODIFICA la opcion ajena; con el fix, 404.
 *
 *   pnpm --filter backend test:aislamiento                                  (localhost:3000)
 *   API_URL=https://api.clubio.lat pnpm --filter backend test:aislamiento
 *
 * Necesita `PIN_ENCARGADO` (lo carga el script npm desde .env.secrets).
 * Sin API_URL apunta a local: para correr contra produccion hay que deployar el fix antes.
 */
const API = process.env.API_URL || 'http://localhost:3000';
const SLUG = process.env.TENANT_SLUG || 'bar-la-esquina';
const PIN = process.env.PIN_ENCARGADO;

let fallos = 0;
function chk(etiqueta, cond, extra = '') {
  console.log(`  ${cond ? 'OK   ' : 'FALLA'} ${etiqueta}${extra ? '   -> ' + extra : ''}`);
  if (!cond) fallos += 1;
}

async function req(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json', 'X-Tenant-Slug': SLUG };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const texto = await res.text();
  let data = null;
  try { data = texto ? JSON.parse(texto) : null; } catch { data = texto; }
  return { status: res.status, data };
}

(async () => {
  if (!PIN) {
    console.log('FALTA PIN_ENCARGADO en el entorno (revisar .env.secrets).');
    process.exit(2);
  }
  console.log(`API: ${API}   tenant: ${SLUG}\n`);

  const login = await req('POST', '/api/auth/empleado/login', { negocioSlug: SLUG, pin: PIN });
  chk('login de staff (ENCARGADO)', login.status === 201 || login.status === 200, `status=${login.status}`);
  const token = login.data?.accessToken;
  if (!token) {
    console.log('  respuesta:', JSON.stringify(login.data).slice(0, 300));
    process.exit(2);
  }

  const marca = `Harness Aislamiento ${Date.now()}`;
  const crear = (sufijo, nombreOpcion) =>
    req('POST', '/api/modificadores/grupos', {
      nombre: `${marca} ${sufijo}`,
      tipo: 'UNICA_SELECCION',
      obligatorio: false,
      minSelecciones: 0,
      maxSelecciones: 1,
      opciones: [{ nombre: nombreOpcion, precioExtra: 0 }],
    }, token);

  const a = await crear('A', 'Opcion de A');
  const b = await crear('B', 'Opcion de B');
  chk('grupo A creado', a.status === 201 || a.status === 200, `status=${a.status} ${JSON.stringify(a.data?.message ?? '')}`);
  chk('grupo B creado', b.status === 201 || b.status === 200, `status=${b.status} ${JSON.stringify(b.data?.message ?? '')}`);

  const grupoA = a.data?.id;
  const grupoB = b.data?.id;
  const opcionA = a.data?.opciones?.[0]?.id;
  const opcionB = b.data?.opciones?.[0]?.id;
  chk('respuesta con ids de grupo y de opcion', Boolean(grupoA && grupoB && opcionA && opcionB));

  try {
    if (grupoA && opcionA) {
      // 1) CONTROL POSITIVO: la opcion PROPIA si se puede actualizar desde su grupo.
      const propia = await req('PATCH', `/api/modificadores/grupos/${grupoA}`, {
        opciones: [{ id: opcionA, nombre: 'Opcion de A (editada)' }],
      }, token);
      chk('control: editar la opcion PROPIA del grupo', propia.status === 200, `status=${propia.status}`);
    }

    if (grupoA && opcionB) {
      // 2) LA ASERCION: la opcion de OTRO grupo no se toca desde este.
      const ajeno = await req('PATCH', `/api/modificadores/grupos/${grupoA}`, {
        opciones: [{ id: opcionB, nombre: 'HACKEADA DESDE A' }],
      }, token);
      chk('opcion de OTRO grupo -> 404 (con el bug: 200 y la modificaba)',
        ajeno.status === 404, `status=${ajeno.status} ${JSON.stringify(ajeno.data?.message ?? '')}`);
    }

    if (grupoB) {
      // 3) Y no quedo tocada.
      const leerB = await req('GET', `/api/modificadores/grupos/${grupoB}`, undefined, token);
      const nombre = leerB.data?.opciones?.[0]?.nombre;
      chk('la opcion de B quedo intacta', nombre === 'Opcion de B', `nombre=${JSON.stringify(nombre)}`);
    }
  } finally {
    const d1 = grupoA ? await req('DELETE', `/api/modificadores/grupos/${grupoA}?force=true`, undefined, token) : { status: '-' };
    const d2 = grupoB ? await req('DELETE', `/api/modificadores/grupos/${grupoB}?force=true`, undefined, token) : { status: '-' };
    console.log(`\n  limpieza: A=${d1.status} B=${d2.status}`);
  }

  console.log(`\nTOTAL: ${fallos === 0 ? 'OK' : fallos + ' FALLA(S)'}`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => {
  console.log('ERROR:', e && e.message ? e.message : e);
  process.exit(1);
});
