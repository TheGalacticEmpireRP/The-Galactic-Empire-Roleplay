import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {cloudflareClient,projectName} from '../scripts/cloudflare-api.mjs';
import {provision} from '../scripts/provision.mjs';
import {importStatements,importBackup} from '../scripts/import-backup.mjs';
import {setup,input} from './service.test.mjs';
import {runWrangler} from '../scripts/wrangler-command.mjs';

const account='a'.repeat(32),database='12345678-1234-4234-8234-123456789abc';
test('failed database deployment shows the real CLI error without leaking credentials',()=>{
  const environment={CLOUDFLARE_API_TOKEN:'private-test-token',CLOUDFLARE_ACCOUNT_ID:account,SUPPORT_OWNER_EMAIL:'Owner@example.test'};
  assert.throws(()=>runWrangler(['d1','migrations','apply','DB'],{environment,spawn:(executable,args,options)=>{
    assert.equal(options.env.CI,'true');
    return {status:1,stdout:'Applying database migrations',stderr:`SQLITE_ERROR: syntax error near END\nAuthorization: Bearer secret-header-value\nprivate-test-token ${account} owner@example.test https://example.test/?token=secret-query-value`};
  }}),error=>{
    assert.ok(error.message.includes('SQLITE_ERROR: syntax error near END'));
    for(const privateValue of ['private-test-token',account,'owner@example.test','secret-header-value','secret-query-value'])assert.equal(error.message.includes(privateValue),false);
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
test('provisioning binds the database, seals secrets and writes only non-secret configuration',async()=>{
  const env={CLOUDFLARE_API_TOKEN:'private-test-token',CLOUDFLARE_ACCOUNT_ID:account,SUPPORT_OWNER_EMAIL:'Owner@example.test',SUPPORT_PROJECT_NAME:'empire-test',CLOUDFLARE_ACCESS_TEAM:'empire-team',CLOUDFLARE_ACCESS_AUD:'aud-tag'};
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
  assert.equal(prod.d1_databases.DB.id,database);assert.equal(prod.env_vars.OWNER_EMAIL.type,'secret_text');assert.equal(prod.env_vars.RATE_LIMIT_SECRET.value.length,64);
  assert.deepEqual(body.deployment_configs.preview.d1_databases,{});
  for(const data of writes.values()){assert.equal(data.includes('private-test-token'),false);assert.equal(data.includes('owner@example.test'),false);assert.equal(data.includes(prod.env_vars.RATE_LIMIT_SECRET.value),false);}
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
