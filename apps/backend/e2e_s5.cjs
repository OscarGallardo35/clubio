
const { spawn } = require('child_process');
const { PrismaClient } = require('@prisma/client');
const IORedis = require('ioredis');
const BASE='http://localhost:3000/api';
const prisma = new PrismaClient({ datasources:{ db:{ url: process.env.DB_URL } } });
const rds = new IORedis(process.env.REDIS_URL,{tls:String(process.env.REDIS_URL).startsWith('rediss:')?{rejectUnauthorized:false}:undefined});
async function req(m,p,b,h={}){ const r=await fetch(BASE+p,{method:m,headers:{'Content-Type':'application/json',...h},body:b?JSON.stringify(b):undefined}); const t=await r.text(); let j; try{j=JSON.parse(t)}catch{j=t} return {status:r.status,body:j}; }
async function waitServer(){ for(let i=0;i<45;i++){ try{ if((await fetch(BASE+'/health')).ok) return true }catch{} await new Promise(r=>setTimeout(r,700)) } return false }
const ok=(c)=>c?'OK':'FALLO';
const contar=async(pat)=>{ let n=0; const s=rds.scanStream({match:pat,count:500}); for await(const ks of s) n+=ks.length; return n; };
let server=spawn(process.execPath,['dist/main.js'],{cwd:__dirname,stdio:'ignore',env:{...process.env,RATE_PEDIDOS_CREATE_LIMIT:'1000'}});
(async()=>{
 if(!(await waitServer())){ console.log('NO RESPONDE'); server.kill(); process.exit(1) }
 try{
  const neg=await prisma.negocio.findFirst({where:{slug:'bar-la-esquina'},select:{id:true}});
  const sucs=await prisma.sucursal.findMany({where:{negocioId:neg.id},select:{id:true,slug:true,esPrincipal:true}});
  const centro=sucs.find(s=>s.esPrincipal), norte=sucs.find(s=>!s.esPrincipal);
  const TD=(await req('POST','/auth/dueno/login',{negocioSlug:'bar-la-esquina',email:'carlos@barlaesquina.com',password:'dueno123456'})).body.accessToken;
  const Hd={Authorization:`Bearer ${TD}`,'X-Tenant-Slug':'bar-la-esquina'};
  const pat=`sucursal:resolve:${neg.id}:*`;

  console.log('===== FIX del cache del resolver (el que era NO-OP) =====');
  console.log('  claves de resolucion al empezar:', await contar(pat));
  // 1) generar varias claves con requests reales
  await req('POST','/pedidos',{tipo:'MESA',modoPago:'EFECTIVO',nombreCliente:'Cache Test',telefono:'11 5555-4444',mesa:'1',sucursalSlug:'centro',items:[{itemId:(await prisma.itemCarta.findFirst({where:{negocioId:neg.id},select:{id:true}})).id,cantidad:1}]},{'X-Tenant-Slug':'bar-la-esquina'});
  await req('GET','/carta?Sucursal-Slug=norte',null,{...Hd,'X-Sucursal-Slug':'norte'});
  await req('GET','/carta',null,{...Hd,'X-Sucursal-Slug':'centro'});
  const conClaves=await contar(pat);
  console.log('  tras 3 requests con distinta sucursal -> claves:',conClaves,ok(conClaves>0));

  // 2) renombrar la sucursal y verificar que la clave se invalido
  await req('PATCH',`/sucursales/${norte.id}`,{nombre:'Norte Z'},Hd);
  const trasPatch=await contar(pat);
  console.log('  tras PATCH de la sucursal -> claves:',trasPatch,ok(trasPatch===0),'(invalidar() ahora borra por patron)');
  const resp=await req('GET','/carta',null,{...Hd,'X-Sucursal-Slug':'norte'});
  console.log('  el resolver vuelve a responder:',resp.status,ok(resp.status===200),'| claves regeneradas:',await contar(pat));

  // 3) eliminar una sucursal tambien invalida
  const c=await req('POST','/sucursales',{nombre:'Cache X',slug:'cache-x-'+Date.now().toString(36)},Hd);
  await req('GET','/carta',null,{...Hd,'X-Sucursal-Slug':c.body.slug});
  const antes=await contar(pat);
  await req('DELETE',`/sucursales/${c.body.id}?force=true`,null,Hd);
  console.log('  DELETE de sucursal -> claves:',antes,'->',await contar(pat),ok((await contar(pat))===0));
  await prisma.sucursal.deleteMany({where:{id:c.body.id}});

  console.log('\n===== comando one-shot real (createApplicationContext) =====');
 }catch(e){ console.error('ERR',e.message) }
 server.kill();
 await new Promise(r=>setTimeout(r,1200));
 const env2={...process.env,DB_URL:process.env.DB_URL,REDIS_URL:process.env.REDIS_URL};
 let r=subprocess.run([process.execPath,'dist/sucursales/migracion-sucursal.command.js','--dry-run'],{cwd:__dirname,env:env2,capture_output:true,text:true,timeout:120});
 console.log('  --dry-run exit:',r.statusCode);
 console.log((r.stdout+r.stderr).split('\n').filter(l=>l.includes('[migracion')||l.includes('{')||l.includes('}')||l.includes('"')).slice(0,12).join('\n'));
 r=subprocess.run([process.execPath,'dist/sucursales/migracion-sucursal.command.js'],{cwd:__dirname,env:env2,capture_output:true,text:true,timeout:120});
 console.log('  ejecucion exit:',r.statusCode);
 console.log((r.stdout+r.stderr).split('\n').filter(l=>l.includes('[migracion')||l.includes('{')||l.includes('}')||l.includes('"')).slice(0,12).join('\n'));
 await rds.quit(); await prisma.$disconnect();
})();
