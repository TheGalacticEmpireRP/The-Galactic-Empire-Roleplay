import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash} from 'node:crypto';
import {cloudflareClient,projectName} from '../scripts/cloudflare-api.mjs';
import {provision} from '../scripts/provision.mjs';
import {importStatements,importBackup} from '../scripts/import-backup.mjs';
import {setup,input} from './service.test.mjs';
import {runWrangler} from '../scripts/wrangler-command.mjs';
import {waitForSupport} from '../scripts/verify-deployment.mjs';

const ownerCode=randomBytes(32).toString('hex');
const account='a'.repeat(32),database='12345678-1234-4234-8234-123456789abc';
test('deployment waits through rollout errors and verifies public and staff endpoints without writing tickets',async()=>{
  const calls=[],delays=[],logs=[];
  const responses=[new Response('private deployment diagnostics',{status:503}),Response.json({signedIn:false,staff:null,hasAccount:false,auth:{type:'staff-code',ownerConfigured:true}}),Response.json({error:'Restricted'},{status:403}),new Response('<html></html>',{headers:{'content-type':'text/html'}})];
  await waitForSupport('https://empire-test.pages.dev',{attempts:2,request:async(url,options)=>{
    assert.equal(options.redirect,'manual');assert.equal(options.method,undefined);
    calls.push(url);return responses.shift();
  },pause:async ms=>delays.push(ms),log:message=>logs.push(message)});
  assert.deepEqual(calls.map(url=>new URL(url).pathname),['/api/support/session','/api/support/session','/api/support/staff/tickets','/']);
  assert.deepEqual(delays,[5000]);assert.ok(logs[0].includes('HTTP 503'));assert.equal(logs[0].includes('private deployment diagnostics'),false);
});
test('deployment immediately rejects exposed staff data or an authenticated anonymous session',async()=>{
  for(const session of [{signedIn:true,staff:null,hasAccount:true},{signedIn:false,staff:{email:'private@example.test'},hasAccount:false},{signedIn:false,staff:null,hasAccount:false,auth:{type:'staff-code',ownerConfigured:true}}]){
    let calls=0,pauses=0;
    await assert.rejects(waitForSupport('https://empire-test.pages.dev',{request:async()=>++calls===1?Response.json(session):Response.json({items:[{title:'private ticket'}]}),pause:async()=>pauses++,log:()=>{}}),error=>{
      assert.match(error.message,/access verification failed/);assert.equal(error.message.includes('private'),false);return true;
    });
    assert.equal(pauses,0);assert.ok(calls<=2);
  }
});
test('deployment retries are bounded and retain the failing endpoint status',async()=>{
  let calls=0,pauses=0;
  await assert.rejects(waitForSupport('https://empire-test.pages.dev',{attempts:3,request:async()=>{calls++;return new Response('private diagnostics',{status:503});},pause:async()=>pauses++,log:()=>{}}),error=>{
    assert.ok(error.message.includes('https://empire-test.pages.dev'));assert.ok(error.message.includes('HTTP 503'));assert.equal(error.message.includes('private diagnostics'),false);return true;
  });
  assert.equal(calls,3);assert.equal(pauses,2);
});
test('an empty JSON response cannot pass the deployed API check',async()=>{
  await assert.rejects(waitForSupport('https://empire-test.pages.dev',{attempts:1,request:async()=>Response.json({}),log:()=>{}}),/expected anonymous response/);
});
test('failed database deployment shows the real CLI error without leaking credentials',()=>{
  const environment={CLOUDFLARE_API_TOKEN:'private-test-token',CLOUDFLARE_ACCOUNT_ID:account,SUPPORT_OWNER_EMAIL:'Owner@example.test',SUPPORT_OWNER_LOGIN_CODE:ownerCode};
  assert.throws(()=>runWrangler(['d1','migrations','apply','DB'],{environment,spawn:(executable,args,options)=>{
    assert.equal(options.env.CI,'true');
    return {status:1,stdout:'Applying database migrations',stderr:`SQLITE_ERROR: syntax error near END\nAuthorization: Bearer secret-header-value\nprivate-test-token ${account} owner@example.test ${ownerCode} https://example.test/?token=secret-query-value`};
  }}),error=>{
    assert.ok(error.message.includes('SQLITE_ERROR: syntax error near END'));
    for(const privateValue of ['private-test-token',account,'owner@example.test','secret-header-value','secret-query-value',ownerCode])assert.equal(error.message.includes(privateValue),false);
    return true;
  });
});
test('deployment requires credentials and validates the branded name before creating resources',async()=>{
  assert.throws(()=>cloudflareClient({}),/secrets/);
  for(const name of ['../secret','UPPER','name.pages.dev','name;command'])assert.throws(()=>projectName(name));
  let called=false;
  await assert.rejects(provision({CLOUDFLARE_API_TOKEN:'test',CLOUDFLARE_ACCOUNT_ID:account,SUPPORT_OWNER_EMAIL:'invalid'},async()=>{called=true;}),/OWNER_EMAIL/);
  assert.equal(called,false);
});
test('owner setup rejects missing or weak bootstrap codes before touching Cloudflare resources',async()=>{
  for(const code of [undefined,'short','a'.repeat(64),'not-hex'.repeat(10)]){
    let calls=0;
    await assert.rejects(provision({CLOUDFLARE_API_TOKEN:'test',CLOUDFLARE_ACCOUNT_ID:account,SUPPORT_OWNER_EMAIL:'owner@example.test',SUPPORT_OWNER_LOGIN_CODE:code},async()=>{calls++;}),/SUPPORT_OWNER_LOGIN_CODE/);
    assert.equal(calls,0);
  }
});
test('provisioning binds the database, seals secrets and writes only non-secret configuration',async()=>{
  const env={CLOUDFLARE_API_TOKEN:'private-test-token',CLOUDFLARE_ACCOUNT_ID:account,SUPPORT_OWNER_EMAIL:'Owner@example.test',SUPPORT_OWNER_LOGIN_CODE:ownerCode,SUPPORT_PROJECT_NAME:'empire-test'};
  const writes=new Map(),requests=[];
  const request=async(url,opts)=>{
    assert.equal(opts.headers.Authorization,'Bearer private-test-token');requests.push({url,...opts});
    if(url.includes('/d1/database?'))return Response.json({success:true,result:[]});
    if(url.endsWith('/pages/projects/empire-test')&&opts.method==='GET')return Response.json({success:false},{status:404});
    if(url.endsWith('/d1/database'))return Response.json({success:true,result:{uuid:database,name:'empire-test-tickets'}});
    if(url.endsWith('/pages/projects'))return Response.json({success:true,result:{subdomain:'empire-test.pages.dev'}});
    assert.fail('Unexpected API request');
  };
  const result=await provision(env,request,(path,text)=>writes.set(path,text));
  assert.equal(result.url,'https://empire-test.pages.dev');
  const body=JSON.parse(requests.at(-1).body),prod=body.deployment_configs.production;
  assert.equal(prod.d1_databases.DB.id,database);assert.equal(prod.env_vars.OWNER_EMAIL.type,'secret_text');assert.equal(prod.env_vars.RATE_LIMIT_SECRET.value.length,64);assert.equal(prod.env_vars.OWNER_LOGIN_HASH.type,'secret_text');assert.equal(prod.env_vars.OWNER_LOGIN_HASH.value,createHash('sha256').update('tge-staff-code:v1:owner@example.test:'+ownerCode).digest('hex'));
  assert.deepEqual(body.deployment_configs.preview.d1_databases,{});
  for(const data of writes.values()){assert.equal(data.includes('private-test-token'),false);assert.equal(data.includes('owner@example.test'),false);assert.equal(data.includes(prod.env_vars.RATE_LIMIT_SECRET.value),false);assert.equal(data.includes(ownerCode),false);assert.equal(data.includes(prod.env_vars.OWNER_LOGIN_HASH.value),false);}
  const settings=JSON.parse(writes.get('wrangler.json'));assert.deepEqual(settings.env.preview.d1_databases,[]);
});
test('Cloudflare API errors do not leak tokens or private response bodies',async()=>{
  const api=cloudflareClient({CLOUDFLARE_API_TOKEN:'private-token',CLOUDFLARE_ACCOUNT_ID:account},async()=>Response.json({success:false,errors:[{code:1000,message:'private-token private ticket data'}]},{status:403}));
  await assert.rejects(api('d1/database'),e=>!e.message.includes('private-token')&&!e.message.includes('private ticket data')&&e.message.includes('1000'));
});
test('backup import preserves keys, conversation, escaped text and staff roles, and verifies the records',async()=>{
  const source=setup();const b=input();b.description="A member's private request with quotes: '; DROP TABLE tickets; -- and more context.";
  const created=await source.send('tickets','POST',b);assert.equal(created.status,201);
  const backup={format:'tge-support-backup-v1',complete:true,tables:{}};
  for(const table of ['tickets','messages','events','attachments','staff'])backup.tables[table]=source.sql.prepare(`SELECT * FROM ${table}`).all();
  const destination=setup();
  const api=async(path,method,body)=>{
    assert.equal(method,'POST');assert.ok(path.endsWith('/query'));
    const statements=body.batch||[{sql:body.sql}];return statements.map(s=>{
      if(s.sql.startsWith('SELECT'))return {success:true,results:destination.sql.prepare(s.sql).all()};
      destination.sql.exec(s.sql);return {success:true,results:[]};
    });
  };
  assert.equal((await importBackup(backup,database,api)).tickets,1);
  assert.equal((await destination.send('tickets/'+created.data.reference,'GET',undefined,{key:created.data.key})).status,200);
  assert.equal((await importBackup(backup,database,api)).tickets,1);
  destination.sql.prepare('UPDATE tickets SET access_hash=?').run('b'.repeat(64));
  await assert.rejects(importBackup(backup,database,api),/differ/);
  assert.throws(()=>importStatements({...backup,complete:false}));
  assert.throws(()=>importStatements({...backup,tables:{...backup.tables,attachments:[{id:'image'}]}}),/screenshots/);
});
