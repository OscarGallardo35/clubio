
const { spawn } = require('child_process');
const { PrismaClient } = require('@prisma/client');
const BASE='http://localhost:3000/api';
const prisma = new PrismaClient({ datasources:{ db:{ url: process.env.DB_URL } } });
async function req(m,p,b,h={}){ const r=await fetch(BASE+p,{method:m,headers:{'Content-Type':'application/json',...h},body:b?JSON.stringify(b):undefined}); const t=await r.text(); let j; try{j=JSON.parse(t)}catch{j=t} return {status:r.status,body:j}; }
async function waitServer(){ for(let i=0;i<45;i++){ try{ if((await fetch(BASE+'/health')).ok) return true }catch{} await new Promise(r=>setTimeout(r,700)) } return false }
const ok=(c)=>c?'OK':'FALLO';
let server=spawn(process.execPath,['dist/main.js'],{cwd:__dirname,stdio:'ignore',env:{...process.env,RATE_PEDIDOS_CREATE_LIMIT:'1000'}});
const peds=[];
let configOriginal = null;
let negId=null, centroId=null, norteId=null, clubTipos=null, itemPrecioGlobal=null;

async function limpiar(){
  try{
    await prisma.pedido.deleteMany({ where:{ id:{ in: peds.filter(Boolean) } } });
    if (norteId) await prisma.itemCartaSucursal.deleteMany({ where:{ sucursalId: norteId } });
    if (negId) await prisma.configuracionSucursal.deleteMany({ where:{ sucursalId: norteId } });
    // Restaurar la config tal cual estaba: el test la pisa con menuActivo:true y tipos ['MESA'].
    if (negId && configOriginal) await prisma.configuracionClub.update({ where:{ negocioId: negId }, data: configOriginal });
    if (negId && clubTipos) await prisma.configuracionClub.update({ where:{ negocioId: negId }, data:{ tiposPedidoHabilitados: clubTipos, permitirOverrideSucursal:true } });
  }catch(e){ console.log('  (limpieza parcial:', e.message, ')'); }
}

(async()=>{
 if(!(await waitServer())){ console.log('NO RESPONDE'); server.kill(); process.exit(1) }
 try{
  const neg=await prisma.negocio.findFirst({where:{slug:'bar-la-esquina'},select:{id:true}});
  negId=neg.id;
  const sucs=await prisma.sucursal.findMany({where:{negocioId:neg.id},select:{id:true,slug:true,esPrincipal:true}});
  const centro=sucs.find(s=>s.esPrincipal), norte=sucs.find(s=>!s.esPrincipal);
  centroId=centro.id; norteId=norte.id;
  const TD=(await req('POST','/auth/dueno/login',{negocioSlug:'bar-la-esquina',email:'carlos@barlaesquina.com',password:'dueno123456'})).body.accessToken;
  const Hd={Authorization:`Bearer ${TD}`,'X-Tenant-Slug':'bar-la-esquina'};
  const club=await prisma.configuracionClub.findUnique({where:{negocioId:neg.id}});
  clubTipos=club.tiposPedidoHabilitados;
  console.log('  (setup) global: tiposPedido=',JSON.stringify(club.tiposPedidoHabilitados),'| premio="'+club.premioTexto+'" | sellos=',club.sellosParaPremio);

  console.log('\n===== T8: override de config campo por campo (merge delegado) =====');
  const ef0=await req('GET',`/sucursales/${norte.id}/configuracion/efectiva`,null,Hd);
  const c0=ef0.body?.configuracion;
  console.log('  efectiva SIN override -> premio:',JSON.stringify(c0?.premioTexto),'| sellos:',c0?.sellosParaPremio,'| tipos:',JSON.stringify(c0?.tiposPedidoHabilitados),'| overrideAplicado:',c0?.overrideAplicado);

  await prisma.configuracionClub.update({where:{negocioId:neg.id},data:{permitirOverrideSucursal:false}});
  const bloqueado=await req('POST',`/sucursales/${norte.id}/configuracion`,{sellosParaPremio:7},Hd);
  console.log('  permitirOverrideSucursal=false ->',bloqueado.status,ok(bloqueado.status===403),'|',bloqueado.body?.message);
  await prisma.configuracionClub.update({where:{negocioId:neg.id},data:{permitirOverrideSucursal:true}});

  const ov=await req('POST',`/sucursales/${norte.id}/configuracion`,{sellosParaPremio:7,premioTexto:'Premio de NORTE',tiposPedidoHabilitados:[]},Hd);
  console.log('  POST override {sellos:7, premio:"Premio de NORTE", tiposPedido:[]} ->',ov.status,ok(ov.status===200||ov.status===201));
  const c=(await req('GET',`/sucursales/${norte.id}/configuracion/efectiva`,null,Hd)).body?.configuracion;
  console.log(`    premioTexto -> ${JSON.stringify(c?.premioTexto)}  (override) ${ok(c?.premioTexto==='Premio de NORTE')}`);
  console.log(`    sellos      -> ${c?.sellosParaPremio}  (override) ${ok(c?.sellosParaPremio===7)}`);
  console.log(`    tiposPedido -> ${JSON.stringify(c?.tiposPedidoHabilitados)}  ([] -> HEREDA el global) ${ok(JSON.stringify(c?.tiposPedidoHabilitados)===JSON.stringify(clubTipos))}`);
  console.log(`    horasMinimas (sin tocar) -> ${c?.horasMinimasEntreVisitas} vs global ${club.horasMinimasEntreVisitas} ${ok(c?.horasMinimasEntreVisitas===club.horasMinimasEntreVisitas)}`);
  console.log(`    overrideAplicado -> ${c?.overrideAplicado} ${ok(c?.overrideAplicado===true)}`);
  const crudo=await req('GET',`/sucursales/${norte.id}/configuracion`,null,Hd);
  console.log('  override CRUDO (con nulls):',JSON.stringify({sellos:crudo.body?.sellosParaPremio,premio:crudo.body?.premioTexto,horas:crudo.body?.horasMinimasEntreVisitas,tipos:crudo.body?.tiposPedidoHabilitados}));
  const costoMal=await req('POST',`/sucursales/${norte.id}/configuracion`,{costoEnvio:500,tiposPedidoHabilitados:['MESA']},Hd);
  console.log('  costoEnvio sin DELIVERY ->',costoMal.status,ok(costoMal.status===400),'|',costoMal.body?.message);

  console.log('\n===== T9: override de items -> precio en un PEDIDO REAL =====');
  const item=await prisma.itemCarta.findFirst({where:{negocioId:neg.id,disponible:true,gruposModificadores:{none:{}}},select:{id:true,nombre:true,precio:true}});
  itemPrecioGlobal=Number(item.precio);
  console.log('  item:',item.nombre,'| precio global:',itemPrecioGlobal);
  const oi=await req('POST',`/sucursales/${norte.id}/items-override`,{itemCartaId:item.id,precio:9999},Hd);
  console.log('  POST override precio=9999 ->',oi.status,ok(oi.status===200||oi.status===201),'| devuelto:',Number(oi.body?.precio));
  const lista=await req('GET',`/sucursales/${norte.id}/items-override`,null,Hd);
  const fila=(lista.body?.data??[]).find(x=>x.itemCartaId===item.id);
  console.log('  GET overrides ->',lista.body?.total,'|',JSON.stringify({item:fila?.itemNombre,global:fila?.precioGlobal,override:fila?.precioOverride,disp:fila?.disponibleOverride}));

    // Guardamos la config ANTES de pisarla: el teardown la restaura tal cual estaba.
  configOriginal = await prisma.configuracionClub.findUnique({where:{negocioId:neg.id},select:{menuActivo:true,tiposPedidoHabilitados:true}});
await prisma.configuracionClub.update({where:{negocioId:neg.id},data:{menuActivo:true,tiposPedidoHabilitados:['MESA']}});
  const pedN=await req('POST','/pedidos',{tipo:'MESA',modoPago:'EFECTIVO',nombreCliente:'Override Test',telefono:'11 5555-4444',mesa:'3',sucursalSlug:'norte',items:[{itemId:item.id,cantidad:1}]},{'X-Tenant-Slug':'bar-la-esquina'});
  if(pedN.body?.pedidoId) peds.push(pedN.body.pedidoId);
  const pedC=await req('POST','/pedidos',{tipo:'MESA',modoPago:'EFECTIVO',nombreCliente:'Override Test',telefono:'11 5555-4444',mesa:'4',sucursalSlug:'centro',items:[{itemId:item.id,cantidad:1}]},{'X-Tenant-Slug':'bar-la-esquina'});
  if(pedC.body?.pedidoId) peds.push(pedC.body.pedidoId);
  const pn=await prisma.pedido.findUnique({where:{id:pedN.body.pedidoId},select:{items:true}});
  const pc=await prisma.pedido.findUnique({where:{id:pedC.body.pedidoId},select:{items:true}});
  console.log('  PEDIDO NORTE  -> precioBase:',pn?.items[0]?.precioBase,ok(pn?.items[0]?.precioBase===9999),'(usa el override)');
  console.log('  PEDIDO CENTRO -> precioBase:',pc?.items[0]?.precioBase,ok(pc?.items[0]?.precioBase===itemPrecioGlobal),'(usa el global)');

  await req('POST',`/sucursales/${norte.id}/items-override`,{itemCartaId:item.id,disponible:false},Hd);
  const agotado=await req('POST','/pedidos',{tipo:'MESA',modoPago:'EFECTIVO',nombreCliente:'X',telefono:'11 5555-4444',mesa:'5',sucursalSlug:'norte',items:[{itemId:item.id,cantidad:1}]},{'X-Tenant-Slug':'bar-la-esquina'});
  console.log('  NORTE con el item overrideado a disponible=false ->',agotado.status,ok(agotado.status===400),'|',agotado.body?.message);
  const okC=await req('POST','/pedidos',{tipo:'MESA',modoPago:'EFECTIVO',nombreCliente:'X',telefono:'11 5555-4444',mesa:'6',sucursalSlug:'centro',items:[{itemId:item.id,cantidad:1}]},{'X-Tenant-Slug':'bar-la-esquina'});
  if(okC.body?.pedidoId) peds.push(okC.body.pedidoId);
  console.log('  el mismo item en CENTRO sigue vendiendose ->',okC.status,ok(okC.status===201));

  console.log('\n===== T10: bulk con transaccion =====');
  const it2=await prisma.itemCarta.findMany({where:{negocioId:neg.id,disponible:true},select:{id:true},take:3});
  const bulkMal=await req('POST',`/sucursales/${norte.id}/items-override/bulk`,{items:[{itemCartaId:it2[0].id,precio:111},{itemCartaId:'no-existe-xxx',precio:222}]},Hd);
  const escritosTrasMal=await prisma.itemCartaSucursal.count({where:{sucursalId:norte.id,itemCartaId:it2[0].id,precio:111}});
  console.log('  bulk con un item invalido ->',bulkMal.status,ok(bulkMal.status===400),'| el valido NO se escribio (nada a medias):',ok(escritosTrasMal===0));
  const bulkOk=await req('POST',`/sucursales/${norte.id}/items-override/bulk`,{items:it2.map((i,n)=>({itemCartaId:i.id,precio:500+n*100}))},Hd);
  console.log('  bulk valido ->',bulkOk.status,JSON.stringify(bulkOk.body));
  console.log('  filas escritas:',await prisma.itemCartaSucursal.count({where:{sucursalId:norte.id,itemCartaId:{in:it2.map(i=>i.id)}}}),ok((await prisma.itemCartaSucursal.count({where:{sucursalId:norte.id,itemCartaId:{in:it2.map(i=>i.id)}}}))===3));
  const del=await req('DELETE',`/sucursales/${norte.id}/items-override/${item.id}`,null,Hd);
  console.log('  DELETE override ->',del.status,ok(del.status===200),'| quedan:',await prisma.itemCartaSucursal.count({where:{sucursalId:norte.id,itemCartaId:item.id}}));
  console.log('  DELETE otra vez ->',(await req('DELETE',`/sucursales/${norte.id}/items-override/${item.id}`,null,Hd)).status,'(404 esperado)');

  console.log('\n===== T11: migracion one-shot idempotente =====');
  const Mig=require('./dist/sucursales/migracion-sucursal.service').MigracionSucursalService;
  const mig=new Mig(prisma,{registrar:async()=>{}});
  console.log('  diagnostico previo:',JSON.stringify(await mig.diagnostico()));
  const m1=await mig.ejecutar();
  console.log('  1ra corrida ->',JSON.stringify({negocios:m1.negociosRevisados,creadas:m1.sucursalesCreadas,principales:m1.principalesMarcadas,huerfanos:m1.tokensHuérfanos,backfill:m1.tokensBackfilleados}));
  const m2=await mig.ejecutar();
  console.log('  2da corrida ->',JSON.stringify({creadas:m2.sucursalesCreadas,principales:m2.principalesMarcadas,backfill:m2.tokensBackfilleados}));
  console.log('  -> IDEMPOTENTE:',ok(m2.sucursalesCreadas===0&&m2.principalesMarcadas===0&&m2.tokensBackfilleados===0));
  console.log('  sucursales del negocio tras 2 corridas:',await prisma.sucursal.count({where:{negocioId:neg.id}}));
 }catch(e){ console.error('ERR',e.message,e.stack?.split('\n').slice(1,3).join(' | ')) }
 await limpiar();
 server.kill(); await prisma.$disconnect(); setTimeout(()=>process.exit(0),900);
})();
