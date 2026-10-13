import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {setup,input} from './service.test.mjs';
import {createKey,digest} from '../.checks/lib/service.js';
import {hashStaffCode,STAFF_COOKIE} from '../.checks/worker/staff-auth.js';
import StaffLogin from '../.checks/app/staff-login.js';
import worker from '../.checks/worker/index.js';

async function app(){
  const s=setup(),code=createKey();
  s.env.OWNER_LOGIN_HASH=await hashStaffCode(s.env.OWNER_EMAIL,code);
  s.env.ASSETS={fetch:async()=>new Response('<html><body>Staff sign-in</body></html>',{headers:{'Content-Type':'text/html'}})};
  const send=async(path,method='GET',data,options={})=>{
    const headers=new Headers({'cf-connecting-ip':options.ip||'198.51.100.71',...options.headers});
    if(method!=='GET')headers.set('Origin',options.origin||'https://support.test');
    if(data!==undefined&&!(data instanceof FormData))headers.set('Content-Type','application/json');
    if(options.cookie)headers.set('Cookie',options.cookie);
    const before=s.queryCount();
    const request=new Request('https://support.test'+(path==='/staff'?path:'/api/support/'+path),{method,headers,body:data===undefined?undefined:data instanceof FormData?data:JSON.stringify(data)});
    const response=await worker.fetch(request,s.env),type=response.headers.get('content-type')||'';
    return {status:response.status,headers:response.headers,queries:s.queryCount()-before,data:type.includes('application/json')?await response.json():await response.text()};
  };
  const login=async(email=s.env.OWNER_EMAIL,accessCode=code,options={})=>{
    const result=await send('auth/login','POST',{email,code:accessCode},options);
    return {...result,cookie:result.headers.get('set-cookie')?.split(';')[0]};
  };
  const owner=await login();assert.equal(owner.status,200);
  const reviewer=async(email='agent@example.test',role='support')=>{
    assert.equal((await send('staff/members','POST',{email,alias:'Support Officer',role},{cookie:owner.cookie})).status,200);
    const issued=await send('auth/staff-code','POST',{email},{cookie:owner.cookie});assert.equal(issued.status,200);
    const session=await login(email,issued.data.code);assert.equal(session.status,200);
    return {email,code:issued.data.code,cookie:session.cookie};
  };
  return {...s,send,login,owner,code,reviewer};
}

test('native owner sign-in uses a private cookie and stores session hashes only',async()=>{
  const s=await app(),cookie=s.owner.headers.get('set-cookie');
  for(const attribute of ['HttpOnly','Secure','SameSite=Strict','Path=/','Max-Age=28800'])assert.ok(cookie.includes(attribute));
  const token=s.owner.cookie.split('=')[1];assert.match(token,/^[a-f0-9]{64}$/);assert.notEqual(token,s.code);
  const rows=s.sql.prepare('SELECT * FROM staff_sessions').all();assert.equal(rows.length,1);assert.equal(rows[0].token_hash,await digest(token));
  assert.equal(JSON.stringify(rows).includes(s.code),false);assert.equal(JSON.stringify(rows).includes(token),false);
  const session=await s.send('session','GET',undefined,{cookie:s.owner.cookie});
  assert.equal(session.data.staff.role,'owner');assert.deepEqual(session.data.auth,{type:'staff-code',ownerConfigured:true});
  assert.equal((await s.send('staff/tickets','GET',undefined,{cookie:s.owner.cookie})).status,200);
  assert.equal((await s.send('staff/tickets')).status,403);
});
test('unknown emails, wrong codes and forged identity headers cannot claim owner access',async()=>{
  const s=await app();
  for(const [email,code] of [[s.env.OWNER_EMAIL,createKey()],['unknown@example.test',s.code],[s.env.OWNER_EMAIL,s.env.OWNER_LOGIN_HASH]]){
    const result=await s.login(email,code);assert.equal(result.status,401);assert.equal(result.data.error,'Email or access code is incorrect.');assert.equal(result.cookie,undefined);
  }
  const headers={'cf-access-jwt-assertion':'forged','cf-access-authenticated-user-email':s.env.OWNER_EMAIL,'oai-authenticated-user-id':'owner','oai-authenticated-user-email':s.env.OWNER_EMAIL,'Authorization':'Bearer '+s.code};
  assert.equal((await s.send('staff/tickets','GET',undefined,{headers})).status,403);
  assert.equal((await s.send('auth/register','POST',{email:s.env.OWNER_EMAIL,code:s.code,role:'owner'})).status,401);
  assert.equal(s.sql.prepare('SELECT count(*) n FROM staff').get().n,0);
});
test('owner can issue private reviewer codes while actual cookie sessions enforce category roles',async()=>{
  const s=await app(),agent=await s.reviewer(),investigator=await s.reviewer('investigator@example.test','investigator');
  for(const category of ['general','reports','appeals'])assert.equal((await s.send('tickets','POST',input(category))).status,201);
  const queue=await s.send('staff/tickets','GET',undefined,{cookie:agent.cookie});assert.equal(queue.status,200);assert.equal(queue.data.items.length,1);assert.equal(queue.data.items[0].category,'general');
  const investigations=await s.send('staff/tickets','GET',undefined,{cookie:investigator.cookie});assert.equal(investigations.status,200);assert.equal(investigations.data.items.length,2);
  assert.equal((await s.send('auth/staff-code','POST',{email:agent.email},{cookie:agent.cookie})).status,403);
  assert.equal((await s.send('staff/members','GET',undefined,{cookie:agent.cookie})).status,403);
  const stored=s.sql.prepare('SELECT code_hash FROM staff_login_credentials WHERE email=?').get(agent.email);
  assert.equal(stored.code_hash,await hashStaffCode(agent.email,agent.code));assert.notEqual(stored.code_hash,agent.code);
  const members=await s.send('staff/members','GET',undefined,{cookie:s.owner.cookie});
  assert.equal(JSON.stringify(members.data).includes(agent.code),false);assert.equal(JSON.stringify(members.data).includes(stored.code_hash),false);
});
test('resetting a staff code revokes the old code and every existing session immediately',async()=>{
  const s=await app(),reviewer=await s.reviewer(),second=await s.login(reviewer.email,reviewer.code);
  const reset=await s.send('auth/staff-code','POST',{email:reviewer.email},{cookie:s.owner.cookie});assert.equal(reset.status,200);assert.notEqual(reset.data.code,reviewer.code);
  for(const cookie of [reviewer.cookie,second.cookie])assert.equal((await s.send('staff/tickets','GET',undefined,{cookie})).status,401);
  assert.equal((await s.login(reviewer.email,reviewer.code)).status,401);
  const next=await s.login(reviewer.email,reset.data.code);assert.equal(next.status,200);assert.equal((await s.send('staff/tickets','GET',undefined,{cookie:next.cookie})).status,200);
});
test('removing a reviewer deletes credentials and sessions and blocks future sign-in',async()=>{
  const s=await app(),reviewer=await s.reviewer();
  assert.equal((await s.send('staff/members/'+encodeURIComponent(reviewer.email),'DELETE',undefined,{cookie:s.owner.cookie})).status,200);
  assert.equal(s.sql.prepare('SELECT count(*) n FROM staff_login_credentials WHERE email=?').get(reviewer.email).n,0);
  assert.equal(s.sql.prepare('SELECT count(*) n FROM staff_sessions WHERE email=?').get(reviewer.email).n,0);
  assert.equal((await s.login(reviewer.email,reviewer.code)).status,401);
  const denied=await s.send('staff/tickets','GET',undefined,{cookie:reviewer.cookie});assert.equal(denied.status,401);assert.ok(denied.headers.get('set-cookie').includes('Max-Age=0'));
});
test('role changes end old sessions before granting a new set of case permissions',async()=>{
  const s=await app(),reviewer=await s.reviewer();
  assert.equal((await s.send('staff/members','POST',{email:reviewer.email,alias:'Case Investigator',role:'investigator'},{cookie:s.owner.cookie})).status,200);
  assert.equal((await s.send('staff/tickets','GET',undefined,{cookie:reviewer.cookie})).status,401);
  const session=await s.login(reviewer.email,reviewer.code);assert.equal(session.status,200);
  assert.equal((await s.send('session','GET',undefined,{cookie:session.cookie})).data.staff.role,'investigator');
});
test('logout ends one session and logout-all ends every device session',async()=>{
  const s=await app(),reviewer=await s.reviewer(),second=await s.login(reviewer.email,reviewer.code);
  const out=await s.send('auth/logout','POST',undefined,{cookie:reviewer.cookie});assert.equal(out.status,200);assert.ok(out.headers.get('set-cookie').includes('Max-Age=0'));
  assert.equal((await s.send('staff/tickets','GET',undefined,{cookie:reviewer.cookie})).status,401);
  assert.equal((await s.send('staff/tickets','GET',undefined,{cookie:second.cookie})).status,200);
  const third=await s.login(reviewer.email,reviewer.code);
  assert.equal((await s.send('auth/logout-all','POST',undefined,{cookie:second.cookie})).status,200);
  assert.equal((await s.send('staff/tickets','GET',undefined,{cookie:third.cookie})).status,401);
});
test('expired, idle, forged and duplicate session cookies cannot reach private staff data',async()=>{
  const s=await app();
  for(const clause of ['expires_at=0','last_seen_at=0']){
    const session=await s.login();s.sql.exec('UPDATE staff_sessions SET '+clause);
    const result=await s.send('staff/tickets','GET',undefined,{cookie:session.cookie});assert.equal(result.status,401);assert.ok(result.headers.get('set-cookie').includes('Max-Age=0'));
  }
  for(const cookie of [STAFF_COOKIE+'='+createKey(),s.owner.cookie+'; '+s.owner.cookie,STAFF_COOKIE+'='+s.code])assert.equal((await s.send('staff/tickets','GET',undefined,{cookie})).status,401);
});
test('changing the owner code invalidates old owner sessions while staff codes remain valid',async()=>{
  const s=await app(),reviewer=await s.reviewer(),newCode=createKey();
  s.env.OWNER_LOGIN_HASH=await hashStaffCode(s.env.OWNER_EMAIL,newCode);
  assert.equal((await s.send('staff/tickets','GET',undefined,{cookie:s.owner.cookie})).status,401);
  assert.equal((await s.login()).status,401);assert.equal((await s.login(s.env.OWNER_EMAIL,newCode)).status,200);
  assert.equal((await s.send('staff/tickets','GET',undefined,{cookie:reviewer.cookie})).status,200);
});
test('authentication rejects cross-origin writes and oversized or malformed requests',async()=>{
  const s=await app();
  for(const action of ['login','logout','logout-all','staff-code'])assert.equal((await s.send('auth/'+action,'POST',{email:s.env.OWNER_EMAIL,code:s.code},{cookie:s.owner.cookie,origin:'https://attacker.example'})).status,403);
  assert.equal((await s.send('auth/login','GET')).status,405);
  assert.equal((await s.send('auth/login','POST',{email:s.env.OWNER_EMAIL,code:'a'.repeat(3500)})).status,413);
  assert.equal((await s.send('auth/login','POST',[])).status,400);
  assert.equal((await s.send('staff/tickets','GET',undefined,{cookie:s.owner.cookie})).status,200);
});
test('sign-in attempts are limited and rate records contain no plaintext email or IP',async()=>{
  const s=await app();let last;
  for(let i=0;i<21;i++)last=await s.login('missing-'+i+'@example.test',createKey());
  assert.equal(last.status,429);assert.ok(Number(last.headers.get('Retry-After'))>0);
  for(const row of s.sql.prepare('SELECT key FROM rate_limits').all()){assert.equal(row.key.includes('@'),false);assert.equal(row.key.includes('198.51.100'),false);}
});
test('missing owner configuration fails closed and does not block member ticket submission',async()=>{
  const s=await app();delete s.env.OWNER_LOGIN_HASH;
  assert.equal((await s.login()).status,503);
  assert.equal((await s.send('session')).data.auth.ownerConfigured,false);
  assert.equal((await s.send('staff/tickets')).status,403);
  assert.equal((await s.send('tickets','POST',input())).status,201);
  assert.equal((await s.send('/staff')).status,200);
});
test('staff sessions are capped per person and login always creates a fresh token',async()=>{
  const s=await app(),cookies=new Set([s.owner.cookie]);
  for(let i=0;i<6;i++){const result=await s.login();assert.equal(result.status,200);cookies.add(result.cookie);}
  assert.equal(cookies.size,7);assert.equal(s.sql.prepare('SELECT count(*) n FROM staff_sessions').get().n,5);
});
test('authenticated reviewer image uploads still fit the free D1 per-request query limit',async()=>{
  const s=await app(),reviewer=await s.reviewer(),created=await s.send('tickets','POST',input());assert.equal(created.status,201);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9V8AAAAASUVORK5CYII=','base64'),image=Buffer.alloc(8*1024*1024,0xa7);png.copy(image);
  const form=new FormData();form.append('file',new File([image],'evidence.png',{type:'image/png'}));
  const result=await s.send('tickets/'+created.data.reference+'/attachments','POST',form,{cookie:reviewer.cookie});
  assert.equal(result.status,201);assert.ok(result.queries<=50,`Authenticated upload used ${result.queries} D1 queries.`);
});
test('staff login renders accessible email/code fields without an external login provider',()=>{
  const html=renderToStaticMarkup(createElement(StaffLogin,{onSignIn:async()=>{}}));
  for(const label of ['Staff email','Private access code','Sign in to staff console','current-password','username'])assert.ok(html.includes(label));
  assert.equal(html.includes('Cloudflare Access'),false);assert.equal(html.includes('/cdn-cgi/'),false);
  const closed=renderToStaticMarkup(createElement(StaffLogin,{ready:false,onSignIn:async()=>{}}));assert.ok(closed.includes('preparing staff sign-in'));assert.equal(closed.includes('<form'),false);
});
