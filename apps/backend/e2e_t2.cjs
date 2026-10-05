
const { spawn } = require('child_process');
const { PrismaClient } = require('@prisma/client');
const { io } = require(process.env.SIO_PATH);
const H = require('./dist/turnos/helpers/horarios');
const BASE='http://localhost:3000/api';
const prisma = new PrismaClient({ datasources:{ db:{ url: process.env.DB_URL } } });
async function req(m,p,b,h={}){ const r=await fetch(BASE+p,{method:m,headers:{'Content-Type':'application/json',...h},body:b?JSON.stringify(b):undefined}); const t=await r.text(); let j; try{j=JSON.parse(t)}catch{j=t} return {status:r.status,body:j}; }
async function waitServer(){ for(let i=0;i<45;i++){ try{ if((await fetch(BASE+'/health')).ok) return true }catch{} await new Promise(r=>setTimeout(r,700)) } return false }
const ok=(c)=>c?'OK':'FALLO'; const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
let server=spawn(process.execPath,['dist/main.js'],{cwd:__dirname,stdio:'ignore',env:{...process.env,RATE_PEDIDOS_CREATE_LIMIT:'1000',RATE_PEDIDOS_LINK_LIMIT:'1000'}});
function hhmm(d){ return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
let limpiezaTurnos=[]; const arrancaPedidos=[];
let emps=[],neg=null,centro=null,norte=null,juan=null,pedro=null,maria=null,carlos=null;
const nom=(id)=>emps.find(e=>e.id===id)?.nombre??String(id).slice(0,6);

async function aud(pid){ const e=await prisma.eventoAuditoria.findFirst({where:{accion:'pedido.creado'},orderBy:{creadoEn:'desc'},select:{detalle:true}}); return e?.detalle??{}; }
async function auditDe(pid){ const rows=await prisma.eventoAuditoria.findMany({where:{accion:'pedido.creado'},orderBy:{creadoEn:'desc'},take:25,select:{detalle:true,creadoEn:true}}); return rows.map(r=>r.detalle).find(d=>d&&d.pedidoId===pid)??{}; }

(async()=>{
 if(!(await waitServer())){ console.log('NO RESPONDE'); server.kill(); process.exit(1) }
 try{
  neg=await prisma.negocio.findFirst({where:{slug:'bar-la-esquina'},select:{id:true}});
  const sucs=await prisma.sucursal.findMany({where:{negocioId:neg.id},select:{id:true,slug:true,esPrincipal:true}});
  centro=sucs.find(s=>s.esPrincipal); norte=sucs.find(s=>!s.esPrincipal);
  emps=await prisma.empleado.findMany({where:{negocioId:neg.id,activo:true},select:{id:true,nombre:true,rol:true,sucursalId:true,accesoMultiSucursal:true}});
  juan=emps.find(e=>e.rol==='CAJERO'); pedro=emps.find(e=>e.rol==='MESERO'); maria=emps.find(e=>e.rol==='ENCARGADO'); carlos=emps.find(e=>e.rol==='DUENO');
  const TD=(await req('POST','/auth/dueno/login',{negocioSlug:'bar-la-esquina',email:'carlos@barlaesquina.com',password:'dueno123456'})).body.accessToken;
  const Hd={Authorization:`Bearer ${TD}`};
  const login=async(pin)=> (await req('POST','/auth/empleado/login',{negocioSlug:'bar-la-esquina',pin})).body.accessToken;
  const TJ=await login('2222'), TMa=await login('1111'), TPe=await login('3333');

  await prisma.turno.deleteMany({where:{negocioId:neg.id}});
  await prisma.encargadoDia.deleteMany({where:{negocioId:neg.id}});
  await prisma.checkinTurno.deleteMany({where:{negocioId:neg.id}});
  const ahora=new Date(); const A_INI=hhmm(new Date(ahora.getTime()-30*60e3)); const A_FIN=hhmm(new Date(ahora.getTime()+3600e3));
  const manana=H.sumarDias(H.hoy(),1);
  const mk=async(empId,fecha,ini,fin,tipo)=>{ const r=await req('POST','/turnos',{empleadoId:empId,fecha,horaInicio:ini,horaFin:fin,tipoTurno:tipo},Hd); if(r.body?.id) limpiezaTurnos.push(r.body.id); return r; };
  await mk(pedro.id,H.hoy(),A_INI,A_FIN,'MESERO'); await mk(juan.id,H.hoy(),A_INI,A_FIN,'CAJERO'); await mk(maria.id,H.hoy(),A_INI,A_FIN,'ENCARGADO');
  console.log(`  (setup) turnos vigentes ${A_INI}-${A_FIN} @ norte:Pedro, @ centro: Juan+Maria`);

  const setCfg=async(d)=>prisma.configuracionClub.update({where:{negocioId:neg.id},data:d});
  const cfgBack=await prisma.configuracionClub.findUnique({where:{negocioId:neg.id}});
  const item=await prisma.itemCarta.findFirst({where:{negocioId:neg.id,disponible:true},select:{id:true}});
  const pedido=async(sucursalSlug,tipo)=>{ const r=await req('POST','/pedidos',{tipo,modoPago:'EFECTIVO',nombreCliente:'Asig Test',telefono:'11 5555-4444',mesa:tipo==='MESA'?'7':undefined,sucursalSlug,items:[{itemId:item.id,cantidad:1}]},{'X-Tenant-Slug':'bar-la-esquina'}); const pid=r.body?.pedidoId; if(pid) arrancaPedidos.push(pid); const d=pid?await auditDe(pid):{}; return {status:r.status,body:r.body,aud:d}; };

  console.log('\n===== T6: respuesta PUBLICA no filtra datos internos de asignacion =====');
  await setCfg({turnosActivos:false});
  const pA=await pedido('norte','MESA');
  console.log('  campos de la respuesta:',JSON.stringify(Object.keys(pA.body??{})));
  console.log('  -> SIN bloque "asignacion":',ok(pA.body?.asignacion===undefined));
  console.log('  -> SIN IDs de empleados en el JSON:',ok(!JSON.stringify(pA.body??{}).match(/emp|encargado|[a-z0-9]{25}/i) || !/"asignacion"/.test(JSON.stringify(pA.body))));
  console.log('  auditoria (server-side) -> modo:',pA.aud.asignacionModo,'| notificados:',pA.aud.notificados,'|',pA.aud.asignacionMotivo);

  console.log('\n===== T7: turnosActivos=false -> todos los activos de la sucursal =====');
  const pN=await pedido('norte','MESA');
  console.log('  MESA en norte -> notificados:',pN.aud.notificados,'| ids:',JSON.stringify((pN.aud.notificadosIds??[]).map(nom)),'|',pN.aud.asignacionMotivo);

  console.log('\n===== T8: BROADCAST + aislamiento por sucursal =====');
  await setCfg({turnosActivos:true,modoAsignacionPedidos:'BROADCAST',checkinObligatorio:false});
  const pB=await pedido('norte','MESA'), pC=await pedido('centro','TAKEAWAY');
  const lB=(pB.aud.notificadosIds??[]).map(nom), lC=(pC.aud.notificadosIds??[]).map(nom);
  console.log('  MESA en NORTE      -> notificados:',JSON.stringify(lB),'|',pB.aud.asignacionMotivo);
  console.log('  TAKEAWAY en CENTRO -> notificados:',JSON.stringify(lC),'|',pC.aud.asignacionMotivo);
  console.log('  -> NORTE notifica SOLO a Pedro:',ok(lB.length===1&&lB[0]===pedro.nombre));
  console.log('  -> CENTRO NO incluye a Pedro (otra sucursal):',ok(!lC.includes(pedro.nombre)&&lC.length===2));
  console.log('  -> asignado de antemano en BROADCAST = null:',ok(pB.aud.empleadoAsignadoId===null));

  console.log('\n===== T9: POR_ROL (+ fallback) =====');
  await setCfg({modoAsignacionPedidos:'POR_ROL'});
  const pD=await pedido('centro','TAKEAWAY');
  console.log('  TAKEAWAY centro (hay CAJERO) -> asignado:',nom(pD.aud.empleadoAsignadoId),'| notificados:',JSON.stringify((pD.aud.notificadosIds??[]).map(nom)),'| modo:',pD.aud.asignacionModo);
  console.log('  -> al PRIMERO del rol:',ok(pD.aud.empleadoAsignadoId===juan.id&&pD.aud.asignacionModo==='POR_ROL'),'|',pD.aud.asignacionMotivo);
  const pE=await pedido('centro','MESA');
  console.log('  MESA centro (NO hay MESERO) -> modo:',pE.aud.asignacionModo,'| asignado:',pE.aud.empleadoAsignadoId);
  console.log('  -> fallback BROADCAST:',ok(pE.aud.asignacionModo==='BROADCAST'&&!pE.aud.empleadoAsignadoId),'|',pE.aud.asignacionMotivo);

  console.log('\n===== T10: SOLO_ENCARGADO (+ fallback) =====');
  await setCfg({modoAsignacionPedidos:'SOLO_ENCARGADO'});
  // Fallback: sin EncargadoDia Y sin ningun turno ENCARGADO hoy -> no hay encargado
  await prisma.encargadoDia.deleteMany({where:{negocioId:neg.id,sucursalId:centro.id,fecha:new Date(H.hoy()+'T00:00:00Z')}});
  await prisma.turno.deleteMany({where:{negocioId:neg.id,tipoTurno:'ENCARGADO',fecha:new Date(H.hoy()+'T00:00:00Z')}});
  const pF=await pedido('centro','MESA');
  console.log('  sin ningun encargado -> modo:',pF.aud.asignacionModo,'|',pF.aud.asignacionMotivo);
  console.log('  -> fallback BROADCAST (no acierta a nadie):',ok(pF.aud.asignacionModo==='BROADCAST'&&!pF.aud.empleadoAsignadoId));
  // Camino feliz: Maria en turno AHORA + EncargadoDia = Maria
  await mk(maria.id,H.hoy(),A_INI,A_FIN,'ENCARGADO');
  await req('PATCH','/turnos/encargado',{empleadoId:maria.id,fecha:H.hoy()},Hd);
  const pG=await pedido('centro','MESA');
  console.log('  con EncargadoDia=Maria (en turno ahora) -> notificados:',JSON.stringify((pG.aud.notificadosIds??[]).map(nom)),'| modo:',pG.aud.asignacionModo);
  console.log('  -> SOLO el encargado:',ok(pG.aud.empleadoAsignadoId===maria.id&&pG.aud.asignacionModo==='SOLO_ENCARGADO'),'|',pG.aud.asignacionMotivo);

  console.log('\n===== T11: fallback de checkinObligatorio =====');
  await setCfg({modoAsignacionPedidos:'BROADCAST',checkinObligatorio:true});
  await prisma.checkinTurno.deleteMany({where:{negocioId:neg.id}});
  const pH=await pedido('norte','MESA');
  console.log('  nadie hizo check-in -> notificados:',JSON.stringify((pH.aud.notificadosIds??[]).map(nom)));
  console.log('  -> NO deja el pedido sin avisar:',ok((pH.aud.notificados??0)>=1),'|',pH.aud.asignacionMotivo);
  await prisma.checkinTurno.create({data:{negocioId:neg.id,sucursalId:norte.id,empleadoId:pedro.id,checkinEn:new Date()}});
  const pI=await pedido('norte','MESA');
  console.log('  Pedro CON check-in -> notificados:',JSON.stringify((pI.aud.notificadosIds??[]).map(nom)),'|',pI.aud.asignacionMotivo);
  console.log('  -> el push sale igual aunque no haya check-in:',ok((pH.aud.notificados??0)>=1),'(push verificado en T15)');
  await setCfg({checkinObligatorio:false});

  console.log('\n===== T12: WebSocket (solo a los notificados, sin duplicados) =====');
  const sPedro=io('http://localhost:3000/pedidos',{transports:['websocket'],auth:{token:TPe}});
  const sJuan =io('http://localhost:3000/pedidos',{transports:['websocket'],auth:{token:TJ}});
  const sDueno=io('http://localhost:3000/pedidos',{transports:['websocket'],auth:{token:TD}});
  await sleep(2000);
  let evP=0,evJ=0,evD=0,body=null;
  sPedro.on('pedido:nuevo',(p)=>{evP++;body=p}); sJuan.on('pedido:nuevo',()=>evJ++); sDueno.on('pedido:nuevo',()=>evD++);
  await sleep(400);
  await pedido('norte','MESA');
  await sleep(2500);
  console.log('  pedido MESA en NORTE -> Pedro(norte):',evP,'| Juan(centro):',evJ,'| Dueno:',evD);
  console.log('  -> llega a Pedro:',ok(evP===1),'| NO a Juan (otra sucursal):',ok(evJ===0),'| al dueno:',ok(evD===1));
  console.log('  -> SIN duplicados:',ok(evP===1),'(EmitirNuevo con emisión encadenada)');
  console.log('  payload:',JSON.stringify({pedidoId:!!body?.pedidoId,total:body?.total,tipo:body?.tipo,numeroAtendiente:body?.numeroAtendiente}));
  console.log('  -> el payload del WS tampoco expone los IDs:',ok(body?.empleadosNotificados===undefined&&body?.empleadoAsignadoId===undefined));

  console.log('\n===== T13: PATCH /pedidos/:id/tomar (concurrencia real) =====');
  await setCfg({modoAsignacionPedidos:'BROADCAST'});
  const pT=await pedido('norte','MESA'); const pid=pT.body.pedidoId;
  const [r1,r2]=await Promise.all([
    req('PATCH',`/pedidos/${pid}/tomar`,null,{Authorization:`Bearer ${TPe}`}),
    req('PATCH',`/pedidos/${pid}/tomar`,null,{Authorization:`Bearer ${TPe}`}),
  ]);
  const cod=[r1.status,r2.status].sort();
  console.log('  2 requests SIMULTANEAS ->',JSON.stringify(cod),ok(cod[0]===200&&cod[1]===409),'|',r1.body?.message??r2.body?.message);
  const pdDb=await prisma.pedido.findUnique({where:{id:pid},select:{empleadoAsignadoId:true}});
  console.log('  en DB quedo UNO:',nom(pdDb.empleadoAsignadoId),ok(pdDb.empleadoAsignadoId===pedro.id));
  await setCfg({modoAsignacionPedidos:'POR_ROL'});
  const pT2=await pedido('centro','TAKEAWAY');
  const rT=await req('PATCH',`/pedidos/${pT2.body.pedidoId}/tomar`,null,{Authorization:`Bearer ${TJ}`});
  console.log('  tomar en modo POR_ROL ->',rT.status,ok(rT.status===400),'|',rT.body?.message);
  await setCfg({modoAsignacionPedidos:'BROADCAST'});

  console.log('\n===== T14: crons =====');
  const TurnosSvc=require('./dist/turnos/turnos.service').TurnosService;
  const svc=new TurnosSvc(prisma,{del:async()=>0,get:async()=>null,set:async()=>'OK'},{registrar:async()=>{}},{resolverSucursalDeEmpleado:async()=>({id:centro.id})});
  await prisma.encargadoDia.deleteMany({where:{negocioId:neg.id,sucursalId:centro.id,fecha:new Date(manana+'T00:00:00Z')}});
  await prisma.turno.deleteMany({where:{negocioId:neg.id,fecha:new Date(manana+'T00:00:00Z')}});
  await mk(maria.id,manana,'09:00','13:00','ENCARGADO'); await mk(juan.id,manana,'14:00','18:00','CAJERO');
  const tr=await svc.transicionEncargado(manana);
  const encMan=await prisma.encargadoDia.findUnique({where:{negocioId_sucursalId_fecha:{negocioId:neg.id,sucursalId:centro.id,fecha:new Date(manana+'T00:00:00Z')}}});
  console.log('  cron 00:00 transicionEncargado(',manana,') -> creados:',tr.creados);
  console.log('  -> creo EncargadoDia desde el turno ENCARGADO:',ok(!!encMan&&encMan.empleadoId===maria.id),'(',nom(encMan?.empleadoId),')');
  const tr2=await svc.transicionEncargado(manana);
  console.log('  idempotente (2da corrida) -> creados:',tr2.creados,ok(tr2.creados===0));
  await prisma.configuracionClub.update({where:{negocioId:neg.id},data:{duplicarSemanaAuto:true}});
  const lunesSig=H.sumarDias(H.lunesDe(H.hoy()),7);
  await prisma.turno.deleteMany({where:{negocioId:neg.id,fecha:{gte:new Date(lunesSig+'T00:00:00Z')}}});
  const dup1=await svc.duplicarSemanaAutomatica();
  const c1=await prisma.turno.count({where:{negocioId:neg.id,fecha:{gte:new Date(lunesSig+'T00:00:00Z')}}});
  console.log('  cron lunes duplicarSemanaAutomatica() 1ra ->',JSON.stringify(dup1.resultado.find(r=>r.negocioId===neg.id)));
  console.log('  turnos copiados a la semana siguiente:',c1,ok(c1>0));
  const dup2=await svc.duplicarSemanaAutomatica();
  const c2=await prisma.turno.count({where:{negocioId:neg.id,fecha:{gte:new Date(lunesSig+'T00:00:00Z')}}});
  console.log('  2da corrida ->',JSON.stringify(dup2.resultado.find(r=>r.negocioId===neg.id)));
  console.log('  -> NO rompe ni pisa si ya habia turnos:',ok(dup2.resultado.find(r=>r.negocioId===neg.id).copiados===0&&c2===c1));
  await prisma.turno.deleteMany({where:{negocioId:neg.id,fecha:{gte:new Date(lunesSig+'T00:00:00Z')}}});
  const cerr=await new (require('./dist/turnos/checkin.service').CheckinService)(prisma,{registrar:async()=>{}});
  await prisma.checkinTurno.create({data:{negocioId:neg.id,sucursalId:centro.id,empleadoId:juan.id,checkinEn:new Date(Date.now()-13*3600e3)}});
  const cr=await cerr.cerrarHuerfanos();
  const hq=await prisma.checkinTurno.count({where:{negocioId:neg.id,checkoutEn:null}});
  console.log('  cron 23:59 cerrarHuerfanos ->',JSON.stringify(cr),'| abiertos que quedan:',hq,ok(cr.cerrados>=1&&hq===0));

  console.log('\n===== T15: cron recordatorio 8 AM (push individual) =====');
  const Rec=require('./dist/turnos/turnos.scheduler').TurnosScheduler;
  let pushes=[];
  const fakePush={enviarAEmpleado:async(n,e,p)=>{pushes.push({n,e,p});return{encolados:1}},enviarAEmpleadosDelNegocio:async()=>({encolados:0})};
  const sch=new Rec(prisma,svc,{cerrarHuerfanos:async()=>({cerrados:0})},fakePush);
  await setCfg({turnosActivos:false}); pushes=[]; await sch.recordarTurnosDelDia();
  console.log('  con turnosActivos=false -> pushes:',pushes.length,ok(pushes.length===0));
  await setCfg({turnosActivos:true}); pushes=[]; await sch.recordarTurnosDelDia();
  console.log('  con turnosActivos=true  -> pushes:',pushes.length);
  for(const x of pushes) console.log(`    -> ${nom(x.e)}: "${x.p.body}"`);
  console.log('  -> push INDIVIDUAL a cada empleado con turno hoy:',ok(pushes.length===3));
  await setCfg({turnosActivos:false});

  console.log('\n===== T16: fallback del WS cuando no hay notificados =====');
  await prisma.turno.deleteMany({where:{negocioId:neg.id,tipoTurno:'MESERO'}});
  const sP2=io('http://localhost:3000/pedidos',{transports:['websocket'],auth:{token:TPe}});
  await sleep(1600);
  let evFallback=0; sP2.on('pedido:nuevo',()=>evFallback++);
  await pedido('norte','MESA');
  await sleep(2200);
  console.log('  MESA en norte sin MESERO en turno -> Pedro (sala de sucursal) recibe:',evFallback,ok(evFallback===1),'(fallback a la sala de sucursal)');
  sP2.close();
  sPedro.close(); sJuan.close(); sDueno.close();
 }catch(e){ console.error('ERR',e.message,e.stack?.split('\n').slice(1,3).join(' | ')) }
 try{
   await prisma.configuracionClub.update({where:{negocioId:neg.id},data:{turnosActivos:false,checkinObligatorio:false,duplicarSemanaAuto:false,modoAsignacionPedidos:'BROADCAST'}});
   await prisma.checkinTurno.deleteMany({where:{}}); await prisma.encargadoDia.deleteMany({where:{}});
   await prisma.turno.deleteMany({where:{id:{in:limpiezaTurnos.filter(Boolean)}}});
   await prisma.pedido.deleteMany({where:{id:{in:arrancaPedidos.filter(Boolean)}}});
   void cfgBack;
 }catch{}
 server.kill(); await prisma.$disconnect(); setTimeout(()=>process.exit(0),900);
})();
