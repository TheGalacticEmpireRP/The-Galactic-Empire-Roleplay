import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {randomBytes,createHash} from 'node:crypto';
import {Miniflare} from 'miniflare';
import {unstable_splitSqlQuery} from 'wrangler';

const email='owner@example.test',code=randomBytes(32).toString('hex');
const runtime=new Miniflare({
  modules:true,scriptPath:'dist/_worker.js',compatibilityDate:'2026-05-15',
  d1Databases:['DB'],
  bindings:{OWNER_EMAIL:email,OWNER_LOGIN_HASH:createHash('sha256').update(`tge-staff-code:v1:${email}:${code}`).digest('hex'),RATE_LIMIT_SECRET:'isolated-runtime-test-only'},
  serviceBindings:{ASSETS:async()=>new Response(readFileSync('dist/index.html'),{headers:{'Content-Type':'text/html'}})}
});
try{
  const db=await runtime.getD1Database('DB');
  for(const name of readdirSync('migrations').filter(name=>name.endsWith('.sql')).sort()){
    await db.batch(unstable_splitSqlQuery(readFileSync('migrations/'+name,'utf8')).map(sql=>db.prepare(sql)));
  }
  async function send(path,method='GET',data,cookie){
    const headers={'Origin':'https://support.test','cf-connecting-ip':'198.51.100.83'};
    if(data!==undefined)headers['Content-Type']='application/json';
    if(cookie)headers.Cookie=cookie;
    const response=await runtime.dispatchFetch('https://support.test'+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)});
    const type=response.headers.get('content-type')||'';
    return {status:response.status,cookie:response.headers.get('set-cookie')?.split(';')[0],data:type.includes('application/json')?await response.json():await response.text()};
  }
  assert.equal((await send('/staff')).status,200);
  assert.equal((await send('/api/support/staff/tickets')).status,403);
  const owner=await send('/api/support/auth/login','POST',{email,code});assert.equal(owner.status,200);assert.ok(owner.cookie);
  assert.equal((await send('/api/support/session','GET',undefined,owner.cookie)).data.staff.role,'owner');
  const reviewer='agent@example.test';
  assert.equal((await send('/api/support/staff/members','POST',{email:reviewer,alias:'Runtime Reviewer',role:'support'},owner.cookie)).status,200);
  const issued=await send('/api/support/auth/staff-code','POST',{email:reviewer},owner.cookie);assert.equal(issued.status,200);
  const session=await send('/api/support/auth/login','POST',{email:reviewer,code:issued.data.code});assert.equal(session.status,200);
  const queue=await send('/api/support/staff/tickets','GET',undefined,session.cookie);assert.equal(queue.status,200);assert.deepEqual(queue.data.items,[]);
  assert.equal((await send('/api/support/auth/staff-code','POST',{email:reviewer},session.cookie)).status,403);
  assert.equal((await send('/api/support/auth/staff-code','POST',{email:reviewer},owner.cookie)).status,200);
  assert.equal((await send('/api/support/staff/tickets','GET',undefined,session.cookie)).status,401);
  assert.equal((await send('/api/support/auth/login','POST',{email:reviewer,code:issued.data.code})).status,401);
  assert.equal((await send('/api/support/auth/logout','POST',undefined,owner.cookie)).status,200);
  assert.equal((await send('/api/support/staff/tickets','GET',undefined,owner.cookie)).status,401);
  console.log('Cloudflare Worker/D1 runtime verified owner sign-in, reviewer codes, authorization, reset and logout.');
}finally{await runtime.dispose();}
