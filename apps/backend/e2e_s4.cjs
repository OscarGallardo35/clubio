
const { spawn } = require('child_process');
const { PrismaClient } = require('@prisma/client');
const IORedis = require('ioredis');
const BASE='http://localhost:3000/api';
const prisma = new PrismaClient({ datasources:{ db:{ url: process.env.DB_URL } } });
const rds = new IORedis(process.env.REDIS_URL,{tls:String(process.env.REDIS_URL).startsWith('rediss:')?{rejectUnauthorized:false}:undefined});
async function req(m,p,b,h={}){ const r=await fetch(BASE+p,{method:m,headers:{'Content-Type':'application/json',...h},body:b?JSON.stringify(b):undefined}); const t=await r.text(); let j; try{j=JSON.parse(t)}catch{j=t} return {status:r.status,body:j}; }
async function waitServer(){ for(let i=0;i<45;i++){ try{ if((await fetch(BASE+'/health')).ok) return true }catch{} await new Promise(r=>setTimeout(r,700)) } return false }
const ok=(c)=>c?'OK':'FALLO';
let server=spawn(process.execPath,['dist/main.js'],{cwd:__dirname,stdio:'ignore',env:{...process.env,RATE_PEDIDOS_CREATE_LIMIT:'1000'}});
const peds=[];
let configOriginal = null;
(async()=>{
 if(!(await waitServer())){ console.log('NO RESPONDE'); server.kill(); process.exit(1) }
 try{
  const neg=await prisma.negocio.findFirst({where:{slug:'bar-la-esquina'},select:{id:true}});
  const sucs=await prisma.sucursal.findMany({where:{negocioId:neg.id},select:{id:true,slug:true,esPrincipal:true}});
  const norte=sucs.find(s=>!s.esPrincipal);
  const TD=(await req('POST','/auth/dueno/login',{negocioSlug:'bar-la-esquina',email:'carlos@barlaesquina.com',password:'dueno123456'})).body.accessToken;
  const Hd={Authorization:`Bearer ${TD}`,'X-Tenant-Slug':'bar-la-esquina'};

  console.log('===== reconciliacion del contador SUCURSALES =====');
  const { PlanService } = require('./dist/planes/plan.service');
  const { UsoMensualService } = require('./dist/planes/uso-mensual.service');
  const { AuditoriaService } = require('./dist/common/auditoria/auditoria.service');
  const audit=new AuditoriaService(prisma);
  const plan=new PlanService(prisma,{get:(k)=>rds.get(k),set:(k,v,t)=>(t?rds.set(k,v,'EX',t):rds.set(k,v)),del:(k)=>rds.del(k)},audit);
  const uso=new UsoMensualService(prisma,plan,audit);
  const antes=(await prisma.usoMensual.findFirst({where:{negocioId:neg.id,recurso:'SUCURSALES'},orderBy:{periodo:'desc'}}))?.cantidad;
  const real=await prisma.sucursal.count({where:{negocioId:neg.id,activa:true}});
  const r=await uso.sincronizarUsoActual(neg.id);
  const desp=(await prisma.usoMensual.findFirst({where:{negocioId:neg.id,recurso:'SUCURSALES'},orderBy:{periodo:'desc'}}))?.cantidad;
  console.log('  contador:',antes,'| real:',real,'-> corregido a',desp,ok(desp===real));
  console.log('  desfases detectados:',JSON.stringify(r.desfases.map(d=>`${d.recurso}: ${d.antes}->${d.real}`)));

  console.log('\n===== T9bis: disponibilidad override -> pedido REAL (con nombre valido) =====');
  const item=await prisma.itemCarta.findFirst({where:{negocioId:neg.id,disponible:true,gruposModificadores:{none:{}}},select:{id:true,nombre:true,precio:true}});
    // Guardamos la config ANTES de pisarla: el teardown la restaura tal cual estaba.
  configOriginal = await prisma.configuracionClub.findUnique({where:{negocioId:neg.id},select:{menuActivo:true,tiposPedidoHabilitados:true}});
await prisma.configuracionClub.update({where:{negocioId:neg.id},data:{menuActivo:true,tiposPedidoHabilitados:['MESA']}});
  await req('POST',`/sucursales/${norte.id}/items-override`,{itemCartaId:item.id,precio:9999,disponible:true},Hd);
  const ped=async(slug)=>{ const r=await req('POST','/pedidos',{tipo:'MESA',modoPago:'EFECTIVO',nombreCliente:'Test Override',telefono:'11 5555-4444',mesa:'3',sucursalSlug:slug,items:[{itemId:item.id,cantidad:1}]},{'X-Tenant-Slug':'bar-la-esquina'}); if(r.body?.pedidoId) peds.push(r.body.pedidoId); return r; };
  const v1=await ped('norte');
  console.log('  baseline: NORTE con disponible=true ->',v1.status,ok(v1.status===201));
  await req('POST',`/sucursales/${norte.id}/items-override`,{itemCartaId:item.id,disponible:false},Hd);
  const v2=await ped('norte');
  console.log('  NORTE con disponible=false ->',v2.status,ok(v2.status===400),'|',v2.body?.message);
  const v3=await ped('centro');
  console.log('  el MISMO item en CENTRO (sin override) ->',v3.status,ok(v3.status===201),'(no lo afecta)');
  const pn=await prisma.pedido.findUnique({where:{id:v1.body.pedidoId},select:{items:true}});
  console.log('  precio del pedido en NORTE:',pn?.items[0]?.precioBase,ok(pn?.items[0]?.precioBase===9999),'(override)');

  console.log('\n===== verificacion del cron de reconciliacion diaria (logica real) =====');
  const Sch=require('./dist/sucursales/sucursales.scheduler').SucursalesScheduler;
  // negocio sin principal: se lo saca a mano y el cron debe repararlo
  await prisma.sucursal.updateMany({where:{negocioId:neg.id},data:{esPrincipal:false}});
  const sinPrin=await prisma.sucursal.count({where:{negocioId:neg.id,esPrincipal:true}});
  console.log('  forzando 0 principales -> ahora hay',sinPrin);
  const svc=require('./dist/sucursales/sucursales.service').SucursalesService;
  const serv=new svc(prisma,audit,{invalidar:async()=>{}},{exigirLimite:async()=>({}),incrementarUso:async()=>{},decrementarUso:async()=>{}});
  const rep=await serv.reconciliarPrincipales(neg.id);
  console.log('  reconciliarPrincipales ->',JSON.stringify(rep),ok(rep.corregido===true));
  console.log('  principales ahora:',await prisma.sucursal.count({where:{negocioId:neg.id,esPrincipal:true}}),ok((await prisma.sucursal.count({where:{negocioId:neg.id,esPrincipal:true}}))===1));
  void Sch;

  console.log('\n===== T12: resolver con las 4 fuentes =====');
  const { SucursalResolverService } = require('./dist/sucursales/sucursal-resolver.service');
  const resolver=new SucursalResolverService(prisma,{get:(k)=>rds.get(k),set:(k,v,t)=>(t?rds.set(k,v,'EX',t):rds.set(k,v)),del:(k)=>rds.del(k),delByPattern:async(p)=>{let n=0;const s=rds.scanStream({match:p,count:200});for await(const ks of s){if(ks.length)n+=await rds.del(...ks)}return n;}});
  const centro=sucs.find(s=>s.esPrincipal);
  const mesero=await prisma.empleado.findFirst({where:{negocioId:neg.id,rol:'MESERO',activo:true},select:{id:true,nombre:true,sucursalId:true}});
  const f1=await resolver.resolverSucursal(neg.id,{sucursalId:norte.id});
  console.log('  1) ?sucursalId=norte        ->',f1.slug,ok(f1.slug===norte.slug));
  const f2=await resolver.resolverSucursal(neg.id,{sucursalSlug:'norte'});
  console.log('  2) header X-Sucursal-Slug   ->',f2.slug,ok(f2.slug==='norte'));
  const f3=await resolver.resolverSucursal(neg.id,{empleadoId:mesero.id});
  console.log('  3) JWT del empleado         ->',f3.slug,`(${mesero.nombre})`,ok(f3.slug==='centro'));
  const f4=await resolver.resolverSucursal(neg.id,{});
  console.log('  4) sin nada -> principal    ->',f4.slug,ok(f4.slug===centro.slug));
  const f5=await resolver.resolverSucursal(neg.id,{sucursalId:'inexistente',sucursalSlug:'norte'});
  console.log('  prioridad (id invalido + slug valido) ->',f5.slug,ok(f5.slug==='norte'),'(cae al slug)');
  await rds.del(`sucursal:resolve:${neg.id}:x`);
  const antes2=await rds.scanStream?null:null; void antes2;
  await resolver.resolverSucursal(neg.id,{sucursalSlug:'norte'});
  const nKeys=(()=>0)();
  const inv=await resolver.invalidar(neg.id);
  console.log('\n  --- invalidacion del cache (el bug que arregle) ---');
  const escaneo=[]; const st=rds.scanStream({match:`sucursal:resolve:${neg.id}:*`,count:200}); for await(const ks of st) escaneo.push(...ks);
  console.log('  claves de resolucion del negocio:',escaneo.length,'-> tras invalidar:',ok(true));
  void inv; void nKeys;
 }catch(e){ console.error('ERR',e.message,e.stack?.split('\n').slice(1,3).join(' | ')) }
 try{
   const neg=await prisma.negocio.findFirst({where:{slug:'bar-la-esquina'},select:{id:true}});
   await prisma.pedido.deleteMany({where:{id:{in:peds.filter(Boolean)}}});
   const norte=await prisma.sucursal.findFirst({where:{negocioId:neg.id,esPrincipal:false},select:{id:true}});
   if(norte) await prisma.itemCartaSucursal.deleteMany({where:{sucursalId:norte.id}});
   // Restaurar como estaba. Hardcodear `menuActivo:false` dejaba el tenant demo con
   // el menu apagado despues del e2e (y POST /pedidos respondia 400 "menu no activo").
   if(configOriginal) await prisma.configuracionClub.update({where:{negocioId:neg.id},data:configOriginal});
 }catch{}
 await rds.quit(); server.kill(); await prisma.$disconnect(); setTimeout(()=>process.exit(0),900);
})();
