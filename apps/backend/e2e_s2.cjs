
const { spawn } = require('child_process');
const { PrismaClient } = require('@prisma/client');
const BASE='http://localhost:3000/api';
const prisma = new PrismaClient({ datasources:{ db:{ url: process.env.DB_URL } } });
async function req(m,p,b,h={}){ const r=await fetch(BASE+p,{method:m,headers:{'Content-Type':'application/json',...h},body:b?JSON.stringify(b):undefined}); const t=await r.text(); let j; try{j=JSON.parse(t)}catch{j=t} return {status:r.status,body:j}; }
async function waitServer(){ for(let i=0;i<45;i++){ try{ if((await fetch(BASE+'/health')).ok) return true }catch{} await new Promise(r=>setTimeout(r,700)) } return false }
const ok=(c)=>c?'OK':'FALLO';
let server=spawn(process.execPath,['dist/main.js'],{cwd:__dirname,stdio:'ignore',env:{...process.env,RATE_PEDIDOS_CREATE_LIMIT:'1000'}});
const sucCreadas=[]; const negs=[];
(async()=>{
 if(!(await waitServer())){ console.log('NO RESPONDE'); server.kill(); process.exit(1) }
 try{
  const neg=await prisma.negocio.findFirst({where:{slug:'bar-la-esquina'},select:{id:true}});
  const emps=await prisma.empleado.findMany({where:{negocioId:neg.id,activo:true},select:{id:true,nombre:true,rol:true,sucursalId:true}});
  const TD=(await req('POST','/auth/dueno/login',{negocioSlug:'bar-la-esquina',email:'carlos@barlaesquina.com',password:'dueno123456'})).body.accessToken;
  const Hd={Authorization:`Bearer ${TD}`,'X-Tenant-Slug':'bar-la-esquina'};
  const saveCfg=await prisma.configuracionSucursal.findMany({where:{sucursalId:{in:(await prisma.sucursal.findMany({where:{negocioId:neg.id},select:{id:true}})).map(s=>s.id)}}});

  console.log('===== FIX: query params booleanos =====');
  const c=await req('POST','/sucursales',{nombre:'Con Empleados',slug:'qe-'+Date.now().toString(36)},Hd);
  sucCreadas.push(c.body.id);
  const libre=await req('GET','/sucursales?activa=true',null,Hd);
  const inact=await req('GET','/sucursales?activa=false',null,Hd);
  console.log('  ?activa=true  ->',libre.body?.total,'| ?activa=false ->',inact.body?.total,ok((libre.body?.total??0)>0&&(inact.body?.total??-1)===0),'(antes devolvia 7 y 7)');
  const prin=await req('GET','/sucursales?esPrincipal=true',null,Hd);
  console.log('  ?esPrincipal=true ->',prin.body?.total,ok(prin.body?.total===1));

  console.log('\n===== T2bis: eliminar con force (ahora si) =====');
  await prisma.empleado.update({where:{id:emps.find(e=>e.rol==='MESERO').id},data:{sucursalId:c.body.id}});
  const sinF=await req('DELETE',`/sucursales/${c.body.id}`,null,Hd);
  console.log('  sin force ->',sinF.status,ok(sinF.status===409),'| empleados:',JSON.stringify((sinF.body?.empleadosActivos??[]).map(e=>e.nombre)));
  const conF=await req('DELETE',`/sucursales/${c.body.id}?force=true`,null,Hd);
  console.log('  con force=true ->',conF.status,ok(conF.status===200),'|',JSON.stringify(conF.body));
  console.log('  con force=1 ->',(await req('DELETE',`/sucursales/${c.body.id}?force=1`,null,Hd)).status,'(200 = ya estaba, o 400 si el bool falla)');
  console.log('  con force=false ->',(await req('DELETE',`/sucursales/${c.body.id}?force=false`,null,Hd)).status);
  const prinId=(await prisma.sucursal.findFirst({where:{negocioId:neg.id,esPrincipal:true},select:{id:true}})).id;
  const pedro=await prisma.empleado.findUnique({where:{id:emps.find(e=>e.rol==='MESERO').id},select:{sucursalId:true}});
  console.log('  el mesero fue reasignado a la principal:',ok(pedro.sucursalId===prinId));
  const fila=await prisma.sucursal.findUnique({where:{id:c.body.id},select:{activa:true}});
  console.log('  soft delete (activa=false, fila viva):',ok(fila.activa===false));

  console.log('\n===== T5bis: aislamiento con force (ahora llega al 404) =====');
  const suf=Date.now().toString(36);
  const negB=await prisma.negocio.create({data:{nombre:'B',slug:'sb-'+suf,plan:'PRO'}}); negs.push(negB.id);
  const sucB=await prisma.sucursal.create({data:{negocioId:negB.id,nombre:'B',slug:'b',esPrincipal:true}});
  await prisma.configuracionClub.create({data:{negocioId:negB.id,premioTexto:'x'}});
  const crossDel=await req('DELETE',`/sucursales/${sucB.id}?force=true`,null,Hd);
  console.log('  A intenta borrar la de B ->',crossDel.status,ok(crossDel.status===404),'|',crossDel.body?.message);
  const crossCfg=await req('POST',`/sucursales/${sucB.id}/configuracion`,{premioTexto:'hack'},Hd);
  console.log('  A escribe la config de la sucursal de B ->',crossCfg.status,ok(crossCfg.status===404));
  const crossItem=await req('GET',`/sucursales/${sucB.id}/items-override`,null,Hd);
  console.log('  A lista los overrides de la de B ->',crossItem.status,ok(crossItem.status===404));

  console.log('\n===== HALLAZGO: el colchon en usos absolutos con limites chicos =====');
  const lim=await prisma.planFeature.findUnique({where:{plan_feature:{plan:'FREE',feature:'sucursales'}}});
  const colchon=(await prisma.configuracionClub.findUnique({where:{negocioId:neg.id},select:{colchonGraciaDefault:true}})).colchonGraciaDefault;
  console.log(`  FREE sucursales: limiteBase=${lim.limite} + colchon ${colchon} -> se bloquea recien en ${lim.limite+colchon+1}`);
  console.log('  -> o sea que un negocio FREE puede crear hasta', lim.limite+colchon, 'sucursales antes del bloqueo');
  console.log('  mismo caso en empleados:', (await prisma.planFeature.findUnique({where:{plan_feature:{plan:'FREE',feature:'empleados'}}})).limite, '+', colchon);
  console.log('  (es consecuencia directa de "usos absolutos", confirmado; lo reporto para que decidas)');
 }catch(e){ console.error('ERR',e.message) }
 try{
   const prinId=(await prisma.sucursal.findFirst({where:{negocioId:neg.id,esPrincipal:true},select:{id:true}})).id;
   await prisma.empleado.updateMany({where:{sucursalId:{in:sucCreadas}},data:{sucursalId:prinId}});
   await prisma.sucursal.deleteMany({where:{id:{in:sucCreadas}}});
   for(const id of negs){ try{ await prisma.negocio.delete({where:{id}}) }catch{} }
 }catch{}
 server.kill(); await prisma.$disconnect(); setTimeout(()=>process.exit(0),900);
})();
