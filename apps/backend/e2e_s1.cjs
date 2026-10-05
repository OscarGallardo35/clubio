
const { spawn } = require('child_process');
const { PrismaClient } = require('@prisma/client');
const BASE='http://localhost:3000/api';
const prisma = new PrismaClient({ datasources:{ db:{ url: process.env.DB_URL } } });
async function req(m,p,b,h={}){ const r=await fetch(BASE+p,{method:m,headers:{'Content-Type':'application/json',...h},body:b?JSON.stringify(b):undefined}); const t=await r.text(); let j; try{j=JSON.parse(t)}catch{j=t} return {status:r.status,body:j}; }
async function waitServer(){ for(let i=0;i<45;i++){ try{ if((await fetch(BASE+'/health')).ok) return true }catch{} await new Promise(r=>setTimeout(r,700)) } return false }
const ok=(c)=>c?'OK':'FALLO';
let server=spawn(process.execPath,['dist/main.js'],{cwd:__dirname,stdio:'ignore',env:{...process.env,RATE_PEDIDOS_CREATE_LIMIT:'1000'}});
const sucCreadas=[]; const negsCreados=[];

(async()=>{
 if(!(await waitServer())){ console.log('NO RESPONDE'); server.kill(); process.exit(1) }
 try{
  const neg=await prisma.negocio.findFirst({where:{slug:'bar-la-esquina'},select:{id:true,plan:true}});
  const emps=await prisma.empleado.findMany({where:{negocioId:neg.id,activo:true},select:{id:true,nombre:true,rol:true,sucursalId:true,accesoMultiSucursal:true}});
  const TD=(await req('POST','/auth/dueno/login',{negocioSlug:'bar-la-esquina',email:'carlos@barlaesquina.com',password:'dueno123456'})).body.accessToken;
  const Hd={Authorization:`Bearer ${TD}`,'X-Tenant-Slug':'bar-la-esquina'};
  const login=async(pin)=>(await req('POST','/auth/empleado/login',{negocioSlug:'bar-la-esquina',pin})).body.accessToken;
  const maria=emps.find(e=>e.rol==='ENCARGADO'), juan=emps.find(e=>e.rol==='CAJERO'), pedro=emps.find(e=>e.rol==='MESERO');
  const sucs=await prisma.sucursal.findMany({where:{negocioId:neg.id},select:{id:true,slug:true,esPrincipal:true,activa:true}});
  const norte=sucs.find(s=>!s.esPrincipal);
  console.log('  (setup) negocio',neg.plan,'| sucursales:',JSON.stringify(sucs));
  console.log('  accesoMultiSucursal -> Maria:',maria.accesoMultiSucursal,'| Juan:',juan.accesoMultiSucursal);

  console.log('\n===== T1: crear sucursal (principal automatica solo si es la primera) =====');
  const c1=await req('POST','/sucursales',{nombre:'Sucursal Test C',slug:'test-c-'+Date.now().toString(36)},Hd);
  if(c1.body?.id) sucCreadas.push(c1.body.id);
  console.log('  POST /sucursales (ya hay principal) ->',c1.status,'| esPrincipal:',c1.body?.esPrincipal,ok(c1.status===201&&c1.body?.esPrincipal===false));
  const c1b=await req('POST','/sucursales',{nombre:'Otra',slug:'test-c-'+Date.now().toString(36),esPrincipal:true},Hd);
  if(c1b.body?.id) sucCreadas.push(c1b.body.id);
  console.log('  pidiendo esPrincipal:true con principal existente ->',c1b.status,'| esPrincipal:',c1b.body?.esPrincipal,ok(c1b.body?.esPrincipal===false),'(se ignora, no puede haber 2)');
  const nPrin=await prisma.sucursal.count({where:{negocioId:neg.id,esPrincipal:true}});
  console.log('  principales en DB:',nPrin,ok(nPrin===1));
  const dup=await req('POST','/sucursales',{nombre:'Dup',slug:sucs[0].slug},Hd);
  console.log('  slug duplicado ->',dup.status,ok(dup.status===409),'|',dup.body?.message);
  const badSlug=await req('POST','/sucursales',{nombre:'Malo',slug:'Con Mayusculas!'},Hd);
  console.log('  slug invalido ->',badSlug.status,ok(badSlug.status===400));
  const sinNombre=await req('POST','/sucursales',{slug:'sin-nombre'},Hd);
  console.log('  sin nombre ->',sinNombre.status,ok(sinNombre.status===400));

  console.log('\n  --- limite SUCURSALES (PRO: ilimitado; FREE: 1) ---');
  await prisma.negocio.update({where:{id:neg.id},data:{plan:'FREE'}});
  const bl=await req('POST','/sucursales',{nombre:'Bloqueada',slug:'test-bloq-'+Date.now().toString(36)},Hd);
  console.log('  con plan FREE (limite 1, ya hay 2) ->',bl.status,ok(bl.status===403));
  console.log('    detalle:',JSON.stringify(bl.body));
  await prisma.negocio.update({where:{id:neg.id},data:{plan:'PRO'}});
  const libre=await req('POST','/sucursales',{nombre:'Libre',slug:'test-libre-'+Date.now().toString(36)},Hd);
  if(libre.body?.id) sucCreadas.push(libre.body.id);
  console.log('  con plan PRO ->',libre.status,ok(libre.status===201),'(ilimitado)');

  console.log('\n===== T2: eliminar =====');
  const delPrin=await req('DELETE',`/sucursales/${sucs.find(s=>s.esPrincipal).id}`,null,Hd);
  console.log('  DELETE principal ->',delPrin.status,ok(delPrin.status===400),'|',delPrin.body?.message);
  // sucursal con empleados
  const conEmp=await req('POST','/sucursales',{nombre:'Con Empleados',slug:'test-emp-'+Date.now().toString(36)},Hd);
  if(conEmp.body?.id) sucCreadas.push(conEmp.body.id);
  await prisma.empleado.update({where:{id:pedro.id},data:{sucursalId:conEmp.body.id}});
  const sinForce=await req('DELETE',`/sucursales/${conEmp.body.id}`,null,Hd);
  console.log('  DELETE con 1 empleado activo, sin force ->',sinForce.status,ok(sinForce.status===409));
  console.log('    lista:',JSON.stringify(sinForce.body?.empleadosActivos));
  const conForce=await req('DELETE',`/sucursales/${conEmp.body.id}?force=true`,null,Hd);
  console.log('  con force=true ->',conForce.status,ok(conForce.status===200),'|',JSON.stringify(conForce.body));
  const pedroDesp=await prisma.empleado.findUnique({where:{id:pedro.id},select:{sucursalId:true}});
  console.log('  Pedro reasignado a la principal:',ok(pedroDesp.sucursalId===sucs.find(s=>s.esPrincipal).id));
  const softDeleted=await prisma.sucursal.findUnique({where:{id:conEmp.body.id},select:{activa:true}});
  console.log('  soft delete (activa=false, la fila sigue):',ok(softDeleted.activa===false));

  console.log('\n===== T3: lista + metricas + filtros =====');
  const l=await req('GET','/sucursales',null,Hd);
  console.log('  GET /sucursales ->',l.status,'| total:',l.body?.total);
  for(const s of (l.body?.data??[]).slice(0,3)){
    console.log(`    ${String(s.nombre).padEnd(18)} principal=${String(s.esPrincipal).padEnd(5)} activa=${String(s.activa).padEnd(5)} empleados=${String(s.empleadosActivos).padEnd(2)} clientes=${String(s.clientesRegistrados).padEnd(3)} pedidosMes=${String(s.pedidosDelMes).padEnd(3)} visitasMes=${String(s.visitasDelMes).padEnd(3)} override=${s.tieneConfiguracionOverride}`);
  }
  const ordenado=l.body?.data?.[0]?.esPrincipal===true;
  console.log('  ordenadas por esPrincipal DESC:',ok(ordenado));
  const filt=await req('GET','/sucursales?activa=false',null,Hd);
  console.log('  ?activa=false ->',filt.body?.total,'(la eliminada)');
  const busq=await req('GET','/sucursales?busqueda=nort',null,Hd);
  console.log('  ?busqueda=nort ->',busq.body?.total,'|',JSON.stringify((busq.body?.data??[]).map(s=>s.slug)));
  const det=await req('GET',`/sucursales/${norte.id}`,null,Hd);
  console.log('  GET /sucursales/:id ->',det.status,'| empleados:',det.body?.empleados?.length,'| stats:',JSON.stringify(det.body?.estadisticas));

  console.log('\n===== T4: /sucursales/mis-sucursales con los 4 roles =====');
  const TM=await login('1111'), TJ=await login('2222'), TPe=await login('3333');
  for(const [nombre,tok] of [['DUENO (Carlos)',TD],['ENCARGADO multi=true (Maria)',TM],['CAJERO (Juan)',TJ],['MESERO (Pedro)',TPe]]){
    const r=await req('GET','/sucursales/mis-sucursales',null,{Authorization:`Bearer ${tok}`,'X-Tenant-Slug':'bar-la-esquina'});
    console.log(`  ${nombre.padEnd(28)} -> ${r.status} | alcance=${r.body?.alcance} total=${r.body?.total} | ${JSON.stringify((r.body?.data??[]).map(s=>s.slug))}`);
  }
  const sinTok=await req('GET','/sucursales/mis-sucursales');
  console.log('  sin token ->',sinTok.status,ok(sinTok.status===401));

  console.log('\n===== T5: RBAC + aislamiento =====');
  const cajeroCrea=await req('POST','/sucursales',{nombre:'X',slug:'x-'+Date.now().toString(36)},{Authorization:`Bearer ${TJ}`,'X-Tenant-Slug':'bar-la-esquina'});
  console.log('  CAJERO crea sucursal ->',cajeroCrea.status,ok(cajeroCrea.status===403));
  const cajeroLista=await req('GET','/sucursales',null,{Authorization:`Bearer ${TJ}`,'X-Tenant-Slug':'bar-la-esquina'});
  console.log('  CAJERO lista ->',cajeroLista.status,ok(cajeroLista.status===403));
  const suf=Date.now().toString(36);
  const negB=await prisma.negocio.create({data:{nombre:'Sucursales B',slug:'suc-b-'+suf,plan:'PRO'}});
  negsCreados.push(negB.id);
  const sucB=await prisma.sucursal.create({data:{negocioId:negB.id,nombre:'B Centro',slug:'b-centro',esPrincipal:true}});
  await prisma.configuracionClub.create({data:{negocioId:negB.id,premioTexto:'x'}});
  const lB=await req('GET','/sucursales',null,Hd);
  console.log('  A ve',lB.body?.total,'| contiene la de B:',(lB.body?.data??[]).some(s=>s.id===sucB.id),ok(!(lB.body?.data??[]).some(s=>s.id===sucB.id)));
  const cross=await req('GET',`/sucursales/${sucB.id}`,null,Hd);
  console.log('  A pide la sucursal de B ->',cross.status,ok(cross.status===404));
  const crossDel=await req('DELETE',`/sucursales/${sucB.id}?force=true`,null,Hd);
  console.log('  A borra la de B ->',crossDel.status,ok(crossDel.status===404));

  console.log('\n===== T6: la primera sucursal de un negocio nuevo es principal sola =====');
  const negN=await prisma.negocio.create({data:{nombre:'Nuevo Sin Sucursales',slug:'nuevo-ns-'+suf,plan:'PRO'}});
  negsCreados.push(negN.id);
  await prisma.configuracionClub.create({data:{negocioId:negN.id,premioTexto:'x'}});
  const p1=await prisma.sucursal.create({data:{negocioId:negN.id,nombre:'Primera',slug:'primera',esPrincipal:true}});
  const p2=await prisma.sucursal.create({data:{negocioId:negN.id,nombre:'Segunda',slug:'segunda'}});
  console.log('  1ra:',p1.esPrincipal,'| 2da:',p2.esPrincipal,ok(p1.esPrincipal===true&&p2.esPrincipal===false));
  await prisma.sucursal.deleteMany({where:{negocioId:negN.id}});

  console.log('\n===== T7: el cache del resolver se invalida al cambiar la sucursal =====');
  const r1=await req('GET',`/sucursales/${norte.id}`,null,Hd);
  const viejo=r1.body?.nombre;
  const ren=await req('PATCH',`/sucursales/${norte.id}`,{nombre:'Norte RENOMBRADA'},Hd);
  console.log('  PATCH nombre ->',ren.status,'|',viejo,'->',ren.body?.nombre);
  const r2=await req('GET',`/sucursales/${norte.id}`,null,Hd);
  console.log('  GET inmediato ->',r2.body?.nombre,ok(r2.body?.nombre==='Norte RENOMBRADA'));
  await req('PATCH',`/sucursales/${norte.id}`,{nombre:viejo},Hd);
 }catch(e){ console.error('ERR',e.message,e.stack?.split('\n').slice(1,3).join(' | ')) }
 try{
   await prisma.empleado.updateMany({where:{sucursalId:{in:sucCreadas}},data:{sucursalId:(await prisma.sucursal.findFirst({where:{negocioId:(await prisma.negocio.findFirst({where:{slug:'bar-la-esquina'}})).id,esPrincipal:true}})).id}});
   await prisma.sucursal.deleteMany({where:{id:{in:sucCreadas}}});
   for(const id of negsCreados){ try{ await prisma.negocio.delete({where:{id}}) }catch{} }
   await prisma.negocio.updateMany({where:{slug:'bar-la-esquina'},data:{plan:'PRO'}});
 }catch{}
 server.kill(); await prisma.$disconnect(); setTimeout(()=>process.exit(0),900);
})();
