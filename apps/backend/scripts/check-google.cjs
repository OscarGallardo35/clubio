/**
 * Integracion con Google Business Profile, contra un MOCK.
 *
 *   pnpm --filter backend test:google
 *
 * Por que en proceso y no contra la API: el backend no arranca en esta maquina
 * (bcrypt sin binario nativo para Node 26), asi que en vez de levantar el server
 * completo se levanta una app Nest MINIMA con los controllers reales, los services
 * reales y el Prisma real, y se apunta `GOOGLE_GBP_API_URL` a un HTTP mock local.
 * Los guards se reemplazan por uno que dice que si y setea `req.user`.
 *
 * Lo que prueba de verdad:
 *   - que `descubrirUbicaciones` pegue en los endpoints MODERNOS (y mande readMask);
 *   - que `sincronizar` arme el nombre completo accounts/{a}/locations/{l}/reviews;
 *   - que un error de Google salga como 400 con el motivo parseado, NO como 500;
 *   - que la DB persista googleAccountId/googleLocationId.
 *
 * Toca la DB real (el negocio del seed): guarda el estado de la integracion y lo
 * restaura al final, y borra las resenas que sembro el mock.
 */
const http = require('http');
const path = require('path');
const { Test } = require('@nestjs/testing');
const request = require('supertest');
const { PrismaClient } = require('@prisma/client');

const DIST = path.join(__dirname, '..', 'dist');
const SLUG = process.env.GOOGLE_TEST_SLUG ?? 'bar-la-esquina';
const REVIEW_IDS = ['mock-review-1', 'mock-review-2', 'mock-review-3'];

let ok = 0, falla = 0;
const chk = (etiqueta, cond, extra = '') => {
  if (cond) { ok++; console.log(`  OK    ${etiqueta}${extra ? '   -> ' + extra : ''}`); }
  else { falla++; console.log(`  FALLA ${etiqueta}${extra ? '   -> ' + extra : ''}`); }
};
const trunc = (v, n = 150) => (v === undefined ? 'undefined' : String(JSON.stringify(v)).slice(0, n));

// ---------------------------------------------------------------- mock de Google
const llamadas = [];
let modo = 'ok';
const CUENTAS = { accounts: [{ name: 'accounts/111', accountName: 'Mock Cuenta', type: 'PERSONAL' }] };
const LOCS = {
  locations: [
    { name: 'accounts/111/locations/222', title: 'Mock Centro', storefrontAddress: { addressLines: ['Av. Siempreviva 742', 'Springfield'] } },
    { name: 'accounts/111/locations/333', title: 'Mock Norte', storefrontAddress: { addressLines: ['Calle Falsa 123'] } },
  ],
};
const REVIEWS = {
  totalReviewCount: 3, averageRating: 4.3,
  reviews: [
    { reviewId: REVIEW_IDS[0], name: 'accounts/111/locations/222/reviews/' + REVIEW_IDS[0], starRating: 'FIVE', comment: 'Excelente atencion', createTime: '2026-09-01T12:00:00Z', reviewer: { displayName: 'Ana Mock', profilePhotoUrl: 'https://x/ana.png' } },
    { reviewId: REVIEW_IDS[1], name: 'accounts/111/locations/222/reviews/' + REVIEW_IDS[1], starRating: 'FOUR', comment: 'Muy rico', createTime: '2026-09-02T12:00:00Z', reviewer: { displayName: 'Beto Mock' } },
    { reviewId: REVIEW_IDS[2], name: 'accounts/111/locations/222/reviews/' + REVIEW_IDS[2], starRating: 'TWO', comment: 'Frio el cafe', createTime: '2026-09-03T12:00:00Z', reviewer: { displayName: 'Caro Mock' } },
  ],
};
const CUOTA_429 = {
  error: {
    code: 429,
    message: "Quota exceeded for quota metric 'Requests' and limit 'Requests per minute' of service 'mybusinessaccountmanagement.googleapis.com' for consumer 'project_number:186759125945'.",
    status: 'RESOURCE_EXHAUSTED',
    details: [{
      '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'RATE_LIMIT_EXCEEDED',
      metadata: {
        quota_limit_value: '0', quota_limit: 'DefaultRequestsPerMinutePerProject',
        quota_metric: 'mybusinessaccountmanagement.googleapis.com/default_requests',
        consumer: 'projects/186759125945',
      },
    }],
  },
};
const mock = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  llamadas.push({ path: url.pathname, query: url.search, auth: req.headers.authorization ?? null });
  const json = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (modo === '429') return json(429, CUOTA_429);
  // Host retirado: Google contesta HTML, no un sobre JSON.
  if (modo === '404html') {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    return res.end('<!DOCTYPE html><html><title>Error 404 (Not Found)!!1</title></html>');
  }
  if (url.pathname === '/v1/accounts') return json(200, CUENTAS);
  if (url.pathname === '/v1/accounts/111/locations') return json(200, LOCS);
  if (url.pathname === `/v1/accounts/111/locations/222/reviews`) return json(200, REVIEWS);
  // Igual que la legacy retirada: HTML, no JSON.
  res.writeHead(404, { 'Content-Type': 'text/html' });
  return res.end('<!DOCTYPE html><html><title>Error 404 (Not Found)!!1</title></html>');
});

(async () => {
  const prisma = new PrismaClient();
  let original = null, creada = false, negocioId = null, duenoId = null;
  let app = null;

  const limpiar = async () => {
    try {
      if (negocioId) {
        await prisma.resenaGoogle.deleteMany({ where: { negocioId, reviewId: { in: REVIEW_IDS } } });
        if (creada) await prisma.integracionGoogle.deleteMany({ where: { negocioId } });
        else if (original) {
          await prisma.integracionGoogle.update({
            where: { negocioId },
            data: {
              accessToken: original.accessToken, refreshToken: original.refreshToken,
              expiryDate: original.expiryDate, estado: original.estado,
              googleAccountId: original.googleAccountId, googleLocationId: original.googleLocationId,
              googleAccountName: original.googleAccountName, googleLocationName: original.googleLocationName,
            },
          });
        }
      }
    } catch (e) { console.log('  (cleanup parcial: ' + e.message.split('\n')[0] + ')'); }
  };

  try {
    // 0) datos reales del seed
    const negocio = await prisma.negocio.findFirst({ where: { slug: SLUG }, select: { id: true } });
    if (!negocio) { console.log('No encontre el negocio ' + SLUG); process.exit(2); }
    negocioId = negocio.id;
    const dueno = await prisma.empleado.findFirst({ where: { negocioId, rol: 'DUENO', activo: true }, select: { id: true, sucursalId: true } });
    if (!dueno) { console.log('No encontre un DUENO activo'); process.exit(2); }
    duenoId = dueno.id;

    original = await prisma.integracionGoogle.findUnique({ where: { negocioId } });
    if (!original) {
      const { encrypt } = require(path.join(DIST, 'common', 'utils', 'crypto.util.js'));
      await prisma.integracionGoogle.create({
        data: {
          negocioId, accessToken: encrypt('mock-access-token'), refreshToken: encrypt('mock-refresh-token'),
          expiryDate: new Date(Date.now() + 3600_000), estado: 'CONECTADO',
        },
      });
      creada = true;
    }
    console.log(`negocio ${SLUG} | dueno ${duenoId} | integracion ${creada ? 'creada para el test' : 'existente (se restaura)'}\n`);

    // 1) mock arriba + env apuntando ahi (antes de requerir el service)
    await new Promise((r) => mock.listen(0, '127.0.0.1', r));
    const puerto = mock.address().port;
    // El mock sirve /v1/... (los hosts reales modernos terminan en /v1), asi que la var
    // incluye el /v1: es el mismo override que usaria Railway para apuntar a un mock.
    process.env.GOOGLE_GBP_API_URL = `http://127.0.0.1:${puerto}/v1`;
    process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'mock-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'mock-secret';
    console.log(`mock de Google en http://127.0.0.1:${puerto}/v1 (GOOGLE_GBP_API_URL apunta aca)\n`);

    const { GoogleController } = require(path.join(DIST, 'google', 'google.controller.js'));
    const { GoogleService } = require(path.join(DIST, 'google', 'google.service.js'));
    const { ResenasController } = require(path.join(DIST, 'resenas', 'resenas.controller.js'));
    const { ResenasService } = require(path.join(DIST, 'resenas', 'resenas.service.js'));
    const { PrismaService } = require(path.join(DIST, 'prisma', 'prisma.service.js'));
    const { StaffGuard } = require(path.join(DIST, 'common', 'guards', 'staff.guard.js'));
    const { TenantGuard } = require(path.join(DIST, 'common', 'guards', 'tenant.guard.js'));
    const { RolesGuard } = require(path.join(DIST, 'common', 'guards', 'roles.guard.js'));
    const { PlanGuard } = require(path.join(DIST, 'planes', 'plan.guard.js'));

    // OJO: `then` tiene que quedar en undefined. Si el stub responde una funcion a
    // CUALQUIER propiedad, el objeto pasa a ser "thenable" y cualquier `await` sobre el
    // (Nest lo hace al compilar) espera una promesa que nunca resuelve -> cuelgue.
    const redisStub = new Proxy({}, {
      get: (_t, prop) => {
        if (typeof prop === 'symbol' || prop === 'then') return undefined;
        if (prop === 'get') return async () => null;
        return async () => 1;
      },
    });
    const auditoria = [];
    const auditoriaStub = { registrar: async (x) => { auditoria.push(x); return { id: 'aud' }; } };
    const webhooksStub = {};

    const { RedisService } = require(path.join(DIST, 'common', 'redis', 'redis.service.js'));
    const { AuditoriaService } = require(path.join(DIST, 'common', 'auditoria', 'auditoria.service.js'));
    const { WebhooksService } = require(path.join(DIST, 'webhooks', 'webhooks.service.js'));

    const modulo = await Test.createTestingModule({
      controllers: [GoogleController, ResenasController],
      providers: [
        GoogleService, ResenasService, PrismaService,
        { provide: RedisService, useValue: redisStub },
        { provide: AuditoriaService, useValue: auditoriaStub },
        { provide: WebhooksService, useValue: webhooksStub },
      ],
    })
      .overrideGuard(StaffGuard).useValue({ canActivate: () => true })
      .overrideGuard(TenantGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .overrideGuard(PlanGuard).useValue({ canActivate: () => true })
      .compile();

    app = modulo.createNestApplication();
    app.use((req, _res, next) => {
      req.user = { id: duenoId, negocioId, rol: 'DUENO', sucursalId: dueno.sucursalId, negocioSlug: SLUG };
      req.tenant = SLUG;
      next();
    });
    await app.init();
    const http_ = app.getHttpServer();

    // ---------------------------------------------------------------- 1) estado
    console.log('[1] estado (sale de nuestra DB, no de Google)');
    let r = await request(http_).get('/google/estado');
    chk('GET /google/estado -> 200', r.status === 200, `status=${r.status}`);
    chk('viene conectado', r.body?.conectado === true, trunc(r.body));
    chk('configurado (client id/secret presentes)', r.body?.configurado === true);

    // ------------------------------------------------------------ 2) ubicaciones
    console.log('\n[2] ubicaciones (endpoints modernos)');
    r = await request(http_).get('/google/ubicaciones');
    chk('GET /google/ubicaciones -> 200', r.status === 200, `status=${r.status} body=${trunc(r.body)}`);
    chk('devuelve las 2 ubicaciones del mock', r.body?.total === 2, `total=${r.body?.total}`);
    const u = (r.body?.data ?? [])[0] ?? {};
    chk('accountId/locationId son SOLO ids', u.accountId === '111' && u.locationId === '222', trunc(u));
    chk('locationName sale de `title`', u.locationName === 'Mock Centro', trunc(u.locationName));
    chk('direccion sale de storefrontAddress', u.direccion === 'Av. Siempreviva 742, Springfield', trunc(u.direccion));
    const llamadaAcc = llamadas.find((l) => l.path === '/v1/accounts' && l.query === '');
    chk('pego en /v1/accounts (accountmanagement)', !!llamadaAcc, llamadaAcc ? llamadaAcc.path : 'no la vi');
    const llamadaLoc = llamadas.find((l) => l.path === '/v1/accounts/111/locations');
    chk('pego en /v1/accounts/{id}/locations (businessinformation)', !!llamadaLoc, llamadaLoc ? llamadaLoc.path : 'no la vi');
    chk('mando readMask name,title,storefrontAddress', !!llamadaLoc && /readMask=name%2Ctitle%2CstorefrontAddress|readMask=name,title,storefrontAddress/.test(llamadaLoc.query), llamadaLoc && llamadaLoc.query);
    chk('mando el Bearer del token guardado', !!llamadaAcc && /^Bearer .+/.test(llamadaAcc.auth ?? ''), llamadaAcc && String(llamadaAcc.auth).slice(0, 14));

    // ------------------------------------------------------------- 3) vincular
    console.log('\n[3] vincular ubicacion');
    r = await request(http_).post('/google/ubicacion').send({ accountId: '111', locationId: '222', accountName: 'Mock Cuenta', locationName: 'Mock Centro' });
    chk('POST /google/ubicacion -> 2xx', r.status >= 200 && r.status < 300, `status=${r.status} body=${trunc(r.body)}`);
    const enDb = await prisma.integracionGoogle.findUnique({ where: { negocioId }, select: { googleAccountId: true, googleLocationId: true, googleLocationName: true } });
    chk('la DB persiste googleAccountId=111 + googleLocationId=222', enDb?.googleAccountId === '111' && enDb?.googleLocationId === '222', trunc(enDb));

    // ---------------------------------------------------------------- 4) sync
    console.log('\n[4] sincronizar resenas');
    r = await request(http_).post('/resenas/sincronizar').send({});
    chk('POST /resenas/sincronizar -> 2xx', r.status >= 200 && r.status < 300, `status=${r.status} body=${trunc(r.body)}`);
    chk('origen oauth (uso Google, no Places)', r.body?.origen === 'oauth', trunc(r.body?.origen));
    chk('trajo las 3 resenas', r.body?.total === 3, `total=${r.body?.total}`);
    const llamadaRev = llamadas.find((l) => l.path.includes('/reviews'));
    chk('pego en el nombre completo accounts/111/locations/222/reviews', !!llamadaRev, llamadaRev ? llamadaRev.path : 'no la vi');
    const enDbR = await prisma.resenaGoogle.findMany({ where: { negocioId, reviewId: { in: REVIEW_IDS } }, select: { reviewId: true, estrellas: true, autorNombre: true, texto: true }, orderBy: { reviewId: 'asc' } });
    chk('las resenas quedaron en la DB', enDbR.length === 3, `${enDbR.length} filas`);
    chk('mapeo de campos (FIVE->5, autor, texto)', enDbR[0]?.estrellas === 5 && enDbR[0]?.autorNombre === 'Ana Mock' && enDbR[0]?.texto === 'Excelente atencion', trunc(enDbR[0]));

    // ------------------------------------------------------------ 5) responder
    console.log('\n[5] responder resena');
    const fila = await prisma.resenaGoogle.findFirst({ where: { negocioId, reviewId: REVIEW_IDS[0] }, select: { id: true } });
    r = await request(http_).post(`/resenas/${fila.id}/responder`).send({ texto: 'Gracias por venir!' });
    chk('POST /resenas/:id/responder -> 2xx', r.status >= 200 && r.status < 300, `status=${r.status} body=${trunc(r.body)}`);
    chk('guarda la respuesta', r.body?.respondida === true && r.body?.respuestaTexto === 'Gracias por venir!', trunc(r.body));

    // --------------------------------------------------- 6) error de Google
    console.log('\n[6] Google devuelve 429 (cuota 0): tiene que ser 400 con motivo, NO 500');
    modo = '429';
    r = await request(http_).get('/google/ubicaciones');
    chk('status 400 (no 500)', r.status === 400, `status=${r.status}`);
    const msg = String(r.body?.message ?? '');
    chk('el motivo es el de Google', /Quota exceeded/.test(msg), trunc(msg, 200));
    chk('incluye la cuota del proyecto (0)', /cuota del proyecto: 0/.test(msg), trunc(msg, 220));
    chk('dejo rastro en auditoria', auditoria.some((a) => a?.accion === 'google.error' && a?.detalle?.contexto === 'ubicaciones'), `${auditoria.length} registros de auditoria`);

    console.log('\n[6b] el fallo de Google NO rompe la integracion (sigue conectada y el sync anda)');
    const tras = await prisma.integracionGoogle.findUnique({ where: { negocioId }, select: { estado: true } });
    chk('la integracion sigue en CONECTADO en la DB', tras?.estado === 'CONECTADO', `estado=${tras?.estado}`);
    r = await request(http_).get('/google/estado');
    chk('GET /google/estado -> 200 y conectado', r.status === 200 && r.body?.conectado === true, `status=${r.status} conectado=${r.body?.conectado}`);
    modo = 'ok';
    r = await request(http_).post('/resenas/sincronizar').send({});
    chk('despues del 429 el sync de resenas sigue funcionando', r.body?.origen === 'oauth' && r.body?.total === 3, trunc(r.body));

    // ---------------------------------------------- 7) host retirado (404 HTML)
    console.log('\n[7] host retirado (404 HTML, como la v4): 400 con motivo, no 500');
    modo = '404html';
    r = await request(http_).get('/google/ubicaciones');
    chk('status 400 (no 500)', r.status === 400, `status=${r.status}`);
    chk('el motivo explica el 404', /host de la API esta retirado/.test(String(r.body?.message ?? '')), trunc(String(r.body?.message), 200));
    modo = 'ok';
    r = await request(http_).get('/google/ubicaciones');
    chk('vuelve a 200 cuando Google responde bien', r.status === 200, `status=${r.status}`);
  } catch (e) {
    falla++;
    console.log('\nEXCEPCION: ' + (e && e.message ? e.message.split('\n')[0] : e));
    if (e && e.stack) console.log(e.stack.split('\n').slice(0, 4).join('\n'));
  } finally {
    await limpiar();
    if (app) await app.close().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    mock.close();
    console.log('\ncleanup: integracion restaurada + resenas del mock borradas');
    console.log(`TOTAL: ${ok} OK, ${falla} FALLA`);
    console.log(falla === 0 ? 'TOTAL OK' : 'TOTAL FALLA');
    process.exit(falla === 0 ? 0 : 1);
  }
})();
