import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,input} from './service.test.mjs';
import {deliverTicketEmail,emailConfigured} from '../.checks/lib/email.js';
import {provision} from '../scripts/provision.mjs';
import {safeDiagnostic} from '../scripts/wrangler-command.mjs';

const owner={id:'owner-id',email:'owner@example.test'};
function mailSetup(){
  const s=setup();Object.assign(s.env,{RESEND_API_KEY:'re_test_secret',EMAIL_FROM:'TGE Support <support@example.test>',SUPPORT_BASE_URL:'https://tge-support.pages.dev'});return s;
}
async function withMail(fn){
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,options)=>{calls.push({url,options,body:JSON.parse(options.body)});return Response.json({id:'mail-'+calls.length});};
  try{return await fn(calls);}finally{globalThis.fetch=original;}
}
async function make(s,email='Member@Example.test'){
  const r=await s.send('tickets','POST',{...input(),notificationEmail:email});assert.equal(r.status,201,JSON.stringify(r.data));return r.data;
}
function confirmation(call){return new URL(call.body.text.match(/https:\/\/[^\s]+\?verifyEmail=[a-f0-9]{64}/)[0]).searchParams.get('verifyEmail');}
async function confirm(s,call){const r=await s.send('notifications/verify','POST',{token:confirmation(call)});assert.equal(r.status,200,JSON.stringify(r.data));return r;}
const path=t=>'tickets/'+t.reference;

test('new tickets opt in with a normalized address, a hashed expiring token and no ticket access in the email',()=>withMail(async calls=>{
  const s=mailSetup(),payload={...input(),notificationEmail:'Member@Example.test'},created=await s.send('tickets','POST',payload),t=created.data;assert.equal(created.status,201);assert.equal(t.emailNotification,'verification_sent');assert.equal(calls.length,1);
  const row=s.sql.prepare('SELECT * FROM ticket_email_preferences').get();assert.equal(row.email,'member@example.test');assert.equal(row.verified_at,null);assert.notEqual(row.verification_hash,confirmation(calls[0]));assert.equal(row.verification_hash.length,64);assert.ok(row.verification_expires_at>Date.now());
  assert.equal(calls[0].url,'https://api.resend.com/emails');assert.equal(calls[0].options.headers.Authorization,'Bearer re_test_secret');
  assert.deepEqual(calls[0].body.to,['member@example.test']);assert.equal(JSON.stringify(calls[0].body).includes(t.key),false);
  const before=await s.send(path(t)+'/messages','POST',{body:'Staff reply before email verification.'},{actor:owner});assert.equal(before.data.emailNotification,'not_enabled');assert.equal(calls.length,1);
  const replay=await s.send('tickets','POST',payload);assert.equal(replay.status,200);assert.equal(replay.data.reference,t.reference);assert.equal(calls.length,1);
  const verified=await confirm(s,calls[0]);assert.equal(verified.data.reference,t.reference);
  assert.equal((await s.send(path(t))).status,404,'Email confirmation cannot read the conversation.');
  assert.equal((await s.send('notifications/verify','POST',{token:confirmation(calls[0])})).status,400);
}));

test('only public authorized staff replies notify the verified ticket member',()=>withMail(async calls=>{
  const s=mailSetup(),t=await make(s);await confirm(s,calls[0]);
  const options={actor:owner},p=path(t);
  assert.equal((await s.send(p+'/messages','POST',{body:'Private investigator note that must never leave the portal.',internal:true},options)).status,201);
  assert.equal((await s.send(p+'/messages','POST',{body:'A follow-up from the member.'},{key:t.key})).status,201);
  await s.send(p,'PATCH',{status:'in_review',reason:'Staff have started reviewing this case.'},options);
  assert.equal(calls.length,1,'Notes, member replies and status changes do not email.');
  assert.equal((await s.send(p+'/messages','POST',{body:'Forged reply with no ticket access.'})).status,404);
  const r=await s.send(p+'/messages','POST',{body:'Private case details must remain in the portal.',email:'attacker@example.test'},options);
  assert.equal(r.status,201);assert.equal(r.data.emailNotification,'sent');assert.equal(calls.length,2);
  const mail=calls[1];assert.deepEqual(mail.body.to,['member@example.test']);assert.equal(mail.body.from,s.env.EMAIL_FROM);assert.ok(mail.body.text.includes('https://tge-support.pages.dev/?ticket='+t.reference));
  for(const secret of [t.key,'Private case details','Private investigator note','attacker@example.test'])assert.equal(JSON.stringify(mail.body).includes(secret),false);
  const status=await s.send(p,'GET',undefined,options);assert.equal(status.data.emailNotifications.enabled,true);assert.equal(status.data.emailNotifications.email,undefined,'Staff do not need the member notification address.');
  assert.equal((await s.send(p+'/notifications','POST',{email:'other@example.test'},options)).status,403);
}));

test('existing tickets can enable, change and remove alerts without invalidating their receipt',()=>withMail(async calls=>{
  const s=mailSetup(),t=await make(s,''),p=path(t),member={key:t.key};assert.equal(calls.length,0);
  assert.equal((await s.send(p+'/notifications','POST',{email:'first@example.test'},member)).status,200);
  const oldToken=confirmation(calls[0]);
  await s.send(p+'/notifications','POST',{email:'second@example.test'},member);
  assert.equal((await s.send('notifications/verify','POST',{token:oldToken})).status,400);
  await confirm(s,calls[1]);
  assert.equal((await s.send(p,'GET',undefined,member)).data.emailNotifications.email,'second@example.test');
  await s.send(p+'/messages','POST',{body:'A staff response for the second email.'},{actor:owner});assert.deepEqual(calls[2].body.to,['second@example.test']);
  assert.equal((await s.send(p+'/notifications','DELETE',undefined,member)).status,200);assert.equal(s.sql.prepare('SELECT count(*) n FROM ticket_email_preferences').get().n,0);
  await s.send(p+'/messages','POST',{body:'Another response after alerts were disabled.'},{actor:owner});assert.equal(calls.length,3);
  assert.equal((await s.send(p,'GET',undefined,member)).status,200);
}));

test('notification failures keep the reply saved and staff can retry it without duplicate emails',()=>withMail(async calls=>{
  const s=mailSetup(),t=await make(s);await confirm(s,calls[0]);const p=path(t),send=globalThis.fetch;
  globalThis.fetch=async()=>new Response('private provider response with secrets',{status:503});
  const reply=await s.send(p+'/messages','POST',{body:'A saved staff reply during a provider outage.'},{actor:owner});
  assert.equal(reply.status,201);assert.equal(reply.data.emailNotification,'failed');assert.equal(s.sql.prepare("SELECT count(*) n FROM messages WHERE kind='staff'").get().n,1);
  const pending=s.sql.prepare('SELECT * FROM ticket_email_outbox').get();assert.equal(pending.status,'failed');assert.equal(pending.last_error,'delivery_failed');
  assert.equal((await s.send(p,'GET',undefined,{actor:owner})).data.emailNotifications.pendingCount,1);
  assert.equal((await s.send(p+'/notifications/retry','POST',undefined,{key:t.key})).status,403);
  globalThis.fetch=send;
  const retry=await s.send(p+'/notifications/retry','POST',undefined,{actor:owner});assert.deepEqual(retry.data,{sent:1,failed:0});assert.equal(calls.length,2);
  const key=calls[1].options.headers['Idempotency-Key'];assert.ok(key.includes(pending.message_id));
  await s.send(p+'/notifications/retry','POST',undefined,{actor:owner});assert.equal(calls.length,2);assert.equal((await deliverTicketEmail(s.env.DB,s.env,pending.message_id)).toString(),'sent');assert.equal(calls.length,2);
}));

test('concurrent retry workers lease the email once and retain a stable provider idempotency key',()=>withMail(async calls=>{
  const s=mailSetup(),t=await make(s);await confirm(s,calls[0]);
  const send=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('offline');};
  await s.send(path(t)+'/messages','POST',{body:'A reply awaiting retry.'},{actor:owner});globalThis.fetch=send;
  const row=s.sql.prepare('SELECT * FROM ticket_email_outbox').get();let release;let requests=0;const gate=new Promise(resolve=>{release=resolve;});
  const request=async(url,options)=>{requests++;assert.match(options.headers['Idempotency-Key'],new RegExp(row.message_id));await gate;return Response.json({id:'accepted-once'});};
  const first=deliverTicketEmail(s.env.DB,s.env,row.message_id,request);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(await deliverTicketEmail(s.env.DB,s.env,row.message_id,request),'pending');release();assert.equal(await first,'sent');assert.equal(requests,1);
}));

test('expired confirmations and old email retries cannot deliver; opting out cancels pending work',()=>withMail(async calls=>{
  const s=mailSetup(),t=await make(s);s.sql.prepare('UPDATE ticket_email_preferences SET verification_expires_at=?').run(Date.now()-1);
  assert.equal((await s.send('notifications/verify','POST',{token:confirmation(calls[0])})).status,400);
  s.sql.prepare('UPDATE ticket_email_preferences SET verification_expires_at=?').run(Date.now()+100000);await confirm(s,calls[0]);
  const send=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('offline');};await s.send(path(t)+'/messages','POST',{body:'A reply to an expired pending alert.'},{actor:owner});globalThis.fetch=send;
  const row=s.sql.prepare('SELECT message_id FROM ticket_email_outbox').get();s.sql.prepare('UPDATE ticket_email_outbox SET created_at=?').run(Date.now()-24*3600000);
  assert.equal(await deliverTicketEmail(s.env.DB,s.env,row.message_id),'failed');assert.equal(calls.length,1);
  await s.send(path(t)+'/notifications','DELETE',undefined,{key:t.key});assert.equal(s.sql.prepare('SELECT count(*) n FROM ticket_email_outbox').get().n,0);
}));

test('bad email input, cross-origin subscription changes and notification spam are rejected',()=>withMail(async calls=>{
  const s=mailSetup();for(const email of ['bad','member@example.test\r\nBcc: attacker@example.test','Name <member@example.test>','a'.repeat(65)+'@example.test'])assert.equal((await s.send('tickets','POST',{...input(),notificationEmail:email})).status,400);
  assert.equal(s.sql.prepare('SELECT count(*) n FROM tickets').get().n,0);
  const t=await make(s,''),p=path(t);
  assert.equal((await s.send(p+'/notifications','POST',{email:'member@example.test'},{key:t.key,origin:'https://evil.test'})).status,403);
  for(let i=0;i<3;i++)assert.equal((await s.send(p+'/notifications','POST',{email:'member@example.test'},{key:t.key})).status,200);
  assert.equal((await s.send(p+'/notifications','POST',{email:'member@example.test'},{key:t.key})).status,429);assert.equal(calls.length,3);
}));

test('missing email configuration is reported without blocking normal tickets or staff replies',async()=>{
  const s=setup(),t=await make(s),p=path(t);assert.equal(t.emailNotification,'unavailable');
  assert.equal((await s.send('session')).data.emailNotificationsAvailable,false);
  assert.equal((await s.send(p+'/notifications','POST',{email:'member@example.test'},{key:t.key})).status,503);
  const reply=await s.send(p+'/messages','POST',{body:'Staff reply with no email service configured.'},{actor:owner});assert.equal(reply.status,201);assert.equal(reply.data.emailNotification,'not_enabled');
  for(const origin of ['http://example.test','https://u:p@example.test','https://example.test/path','https://example.test/?key=secret'])assert.equal(emailConfigured({RESEND_API_KEY:'key',EMAIL_FROM:'a@b.test',SUPPORT_BASE_URL:origin}),false);
});

test('deployment sets email secrets only on the server, preserves existing settings and redacts diagnostics',async()=>{
  const env={CLOUDFLARE_API_TOKEN:'test-token',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),SUPPORT_OWNER_EMAIL:'owner@example.test',SUPPORT_OWNER_LOGIN_CODE:'0123456789abcdef'.repeat(4),RESEND_API_KEY:'re_private_test',SUPPORT_EMAIL_FROM:'TGE Support <support@example.test>'};
  const writes=new Map();let production;
  await provision(env,async(url,options)=>{
    if(url.includes('/d1/database?'))return Response.json({success:true,result:[{uuid:'12345678-1234-4234-8234-123456789abc',name:'tge-support-tickets'}]});
    if(options.method==='GET')return Response.json({success:true,result:{deployment_configs:{production:{d1_databases:{DB:{id:'12345678-1234-4234-8234-123456789abc'}},env_vars:{EXISTING_SETTING:{type:'plain_text',value:'keep'}}}}}});
    production=JSON.parse(options.body).deployment_configs.production;return Response.json({success:true,result:{subdomain:'tge-support.pages.dev'}});
  },(path,data)=>writes.set(path,data));
  assert.equal(production.env_vars.RESEND_API_KEY.type,'secret_text');assert.equal(production.env_vars.EMAIL_FROM.value,env.SUPPORT_EMAIL_FROM);assert.equal(production.env_vars.EXISTING_SETTING.value,'keep');assert.equal(production.env_vars.SUPPORT_BASE_URL.value,'https://tge-support.pages.dev');
  for(const text of writes.values())for(const secret of [env.RESEND_API_KEY,env.SUPPORT_EMAIL_FROM])assert.equal(text.includes(secret),false);
  assert.equal(safeDiagnostic(env.RESEND_API_KEY+' '+env.SUPPORT_EMAIL_FROM,env).includes(env.RESEND_API_KEY),false);
  let touched=false;await assert.rejects(provision({...env,SUPPORT_EMAIL_FROM:''},async()=>{touched=true;}),/both/);assert.equal(touched,false);
});
