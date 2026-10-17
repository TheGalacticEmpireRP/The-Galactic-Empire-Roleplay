import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createHmac,createHash} from 'node:crypto';
import {gmailConfigured,sendGmail} from '../.checks/lib/gmail.js';
import {emailConfigured} from '../.checks/lib/email.js';
import {setup,input} from './service.test.mjs';
import {provision} from '../scripts/provision.mjs';
import {safeDiagnostic} from '../scripts/wrangler-command.mjs';

const secret='0123456789abcdef'.repeat(4),sender='tge-sender@gmail.com';
const url='https://script.google.com/macros/s/TEST_DEPLOYMENT_ID_123456789/exec';
const env={EMAIL_PROVIDER:'gmail',GMAIL_SENDER_URL:url,GMAIL_SENDER_SECRET:secret,EMAIL_FROM:`TGE Support <${sender}>`,SUPPORT_BASE_URL:'https://tge-support.pages.dev'};
const content={text:'A ticket update. Open the support website with your private receipt.',html:'<p>A ticket update.</p>'};
const subject='Support staff replied — TGE-2026-ABCDEF12';

function bridge(){
  const properties=new Map([['TGE_EMAIL_SECRET',secret],['TGE_SENDER_EMAIL',sender]]),sent=[];
  const state={quota:100,fail:false,actual:sender,busy:false};
  const script={PropertiesService:{getScriptProperties:()=>({getProperty:k=>properties.get(k)||null,setProperty:(k,v)=>properties.set(k,v),getProperties:()=>Object.fromEntries(properties),deleteProperty:k=>properties.delete(k)})},Session:{getEffectiveUser:()=>({getEmail:()=>state.actual})},MailApp:{getRemainingDailyQuota:()=>state.quota,sendEmail:m=>{if(state.fail)throw new Error('uncertain Google send');sent.push(m);state.quota--;}},Utilities:{Charset:{UTF_8:'UTF-8'},DigestAlgorithm:{SHA_256:'SHA-256'},computeHmacSha256Signature:(data,key)=>[...createHmac('sha256',key).update(data).digest()],computeDigest:(alg,data)=>[...createHash('sha256').update(data).digest()]},LockService:{getScriptLock:()=>{let owned=false;return {tryLock:()=>{if(state.busy)return false;state.busy=owned=true;return true;},hasLock:()=>owned,releaseLock:()=>{if(owned)state.busy=false;owned=false;}};}},ContentService:{MimeType:{JSON:'application/json'},createTextOutput:text=>({setMimeType:()=>text})}};
  runInNewContext(readFileSync('google-apps-script/GmailSender.gs','utf8'),script);
  const post=envelope=>JSON.parse(script.doPost({postData:{contents:JSON.stringify(envelope)}}));
  const request=async(target,options)=>{assert.equal(target,url);assert.equal(options.method,'POST');return Response.json(post(JSON.parse(options.body)));};
  return {script,properties,sent,state,post,request};
}
function envelope(changes={}){
  const payload=JSON.stringify({version:1,idempotencyKey:'tge-reply/1234567890/abcdef',sentAt:Date.now(),sender,to:'member@example.test',subject,...content,...changes});
  return {payload,signature:createHmac('sha256',secret).update(payload).digest('hex')};
}

test('Gmail sender signs requests and the Apps Script accepts them without reading the inbox',async()=>{
  const b=bridge();const id=await sendGmail(env,'member@example.test',subject,content,'tge-reply/1234567890/abcdef',b.request);
  assert.match(id,/^gmail-[a-f0-9]{64}$/);assert.equal(b.sent.length,1);assert.equal(b.sent[0].to,'member@example.test');assert.equal(b.sent[0].name,'TGE Support');assert.equal(b.sent[0].htmlBody,content.html);
  assert.equal((await sendGmail(env,'member@example.test',subject,content,'tge-reply/1234567890/abcdef',b.request)),id);assert.equal(b.sent.length,1,'Retries cannot duplicate the email.');
  assert.equal(b.script.authorizeSender().sender,sender);
  const manifest=JSON.parse(readFileSync('google-apps-script/appsscript.json','utf8'));assert.deepEqual(manifest.oauthScopes,['https://www.googleapis.com/auth/script.send_mail','https://www.googleapis.com/auth/userinfo.email']);
});

test('the public sender refuses unsigned, modified, stale, multi-recipient and wrong-account requests',()=>{
  const b=bridge();const signed=envelope();assert.equal(b.post({...signed,signature:'0'.repeat(64)}).ok,false);
  assert.equal(b.post({...signed,payload:signed.payload.replace('member@','attacker@')}).ok,false);
  for(const values of [{sentAt:Date.now()-600000},{to:'one@example.test,two@example.test'},{subject:'Unrelated email subject'},{sender:'other@gmail.com'},{idempotencyKey:'anything'}])assert.equal(b.post(envelope(values)).ok,false);
  b.state.actual='wrong-account@gmail.com';assert.equal(b.post(envelope()).ok,false);assert.throws(()=>b.script.authorizeSender());
  assert.equal(b.sent.length,0);assert.equal([...b.properties.keys()].some(k=>k.startsWith('mail_')),false);
});

test('quota and lock failures can be retried but uncertain sends cannot be duplicated',async()=>{
  const b=bridge();b.state.quota=0;assert.equal(b.post(envelope()).error,'daily_limit');assert.equal(b.properties.size,2);
  b.state.quota=10;b.state.busy=true;assert.equal(b.post(envelope()).error,'busy');assert.equal(b.state.busy,true);b.state.busy=false;
  b.state.fail=true;assert.equal(b.post(envelope()).error,'delivery_unknown');b.state.fail=false;assert.equal(b.post(envelope()).error,'delivery_unknown');assert.equal(b.sent.length,0);
  const next=await sendGmail(env,'member@example.test',subject,content,'tge-reply/a-different-message/1234567890',b.request);assert.match(next,/gmail-/);assert.equal(b.sent.length,1);
});

test('Gmail URLs and sender settings are validated before sending any request',async()=>{
  assert.equal(emailConfigured(env),true);
  for(const value of ['https://attacker.test/exec',url+'?key=secret',url.replace('/exec','/dev'),'http://script.google.com/macros/s/TEST_DEPLOYMENT_ID_123456789/exec'])assert.equal(gmailConfigured({...env,GMAIL_SENDER_URL:value}),false);
  assert.equal(emailConfigured({...env,GMAIL_SENDER_SECRET:'invalid',RESEND_API_KEY:'old-resend-key'}),false);
  let called=false;await assert.rejects(sendGmail({...env,GMAIL_SENDER_URL:'https://attacker.test'},'member@example.test',subject,content,'tge-reply/1234567890',async()=>{called=true;}));assert.equal(called,false);
  await assert.rejects(sendGmail(env,'member@example.test',subject,content,'tge-reply/1234567890',async()=>new Response('<html>Sign in</html>',{headers:{'content-type':'text/html'}})));
});

test('the ticket service verifies member email then sends Gmail alerts only for public staff replies',async()=>{
  const b=bridge(),s=setup(),original=globalThis.fetch;Object.assign(s.env,env);globalThis.fetch=b.request;
  try{
    const created=await s.send('tickets','POST',{...input(),notificationEmail:'member@example.test'});assert.equal(created.status,201);assert.equal(created.data.emailNotification,'verification_sent');assert.equal(b.sent.length,1);
    const token=b.sent[0].body.match(/verifyEmail=([a-f0-9]{64})/)[1];assert.equal((await s.send('notifications/verify','POST',{token})).status,200);
    const owner={id:'owner-id',email:'owner@example.test'},path='tickets/'+created.data.reference+'/messages';
    const reply=await s.send(path,'POST',{body:'Private case content must stay on the site.'},{actor:owner});assert.equal(reply.status,201);assert.equal(reply.data.emailNotification,'sent');assert.equal(b.sent.length,2);
    assert.equal(JSON.stringify(b.sent).includes(created.data.key),false);assert.equal(b.sent[1].body.includes('Private case content'),false);
    await s.send(path,'POST',{body:'An internal note for the team.',internal:true},{actor:owner});assert.equal(b.sent.length,2);
    assert.equal(s.sql.prepare('SELECT status FROM ticket_email_outbox').get().status,'sent');
  }finally{globalThis.fetch=original;}
});

test('Gmail deployment takes precedence over the old Resend setup and stores credentials only as server secrets',async()=>{
  const settings={CLOUDFLARE_API_TOKEN:'test-token',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),SUPPORT_OWNER_EMAIL:'owner@example.test',SUPPORT_OWNER_LOGIN_CODE:'0123456789abcdef'.repeat(4),RESEND_API_KEY:'old-unused-resend-key',SUPPORT_EMAIL_FROM:env.EMAIL_FROM,GMAIL_SENDER_URL:url,GMAIL_SENDER_SECRET:secret};
  const writes=[];let production;
  await provision(settings,async(target,options)=>{
    if(target.includes('/d1/database?'))return Response.json({success:true,result:[]});
    if(options.method==='GET')return Response.json({success:false},{status:404});
    if(target.endsWith('/d1/database'))return Response.json({success:true,result:{uuid:'12345678-1234-4234-8234-123456789abc'}});
    production=JSON.parse(options.body).deployment_configs.production;return Response.json({success:true,result:{subdomain:'tge-support.pages.dev'}});
  },(path,value)=>writes.push(value));
  assert.equal(production.env_vars.EMAIL_PROVIDER.value,'gmail');assert.equal(production.env_vars.GMAIL_SENDER_SECRET.type,'secret_text');assert.equal(production.env_vars.GMAIL_SENDER_SECRET.value,secret);assert.equal(production.env_vars.GMAIL_SENDER_URL.value,url);assert.equal(production.env_vars.EMAIL_FROM.value,env.EMAIL_FROM);
  for(const value of writes)for(const privateValue of [secret,url,env.EMAIL_FROM])assert.equal(value.includes(privateValue),false);
  assert.equal(safeDiagnostic(secret+' '+url,settings).includes(secret),false);assert.equal(safeDiagnostic(secret+' '+url,settings).includes(url),false);
  let touched=false;await assert.rejects(provision({...settings,GMAIL_SENDER_SECRET:''},async()=>{touched=true;}),/both/);assert.equal(touched,false);
});
