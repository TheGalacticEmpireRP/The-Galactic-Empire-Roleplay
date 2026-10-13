import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {provision} from '../scripts/provision.mjs';
import {runWrangler} from '../scripts/wrangler-command.mjs';

const name='tge-migrations-test',database='00000000-0000-4000-8000-000000000001';
const files=new Map();
await provision({CLOUDFLARE_API_TOKEN:'local-test-token',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),SUPPORT_OWNER_EMAIL:'local@example.test',SUPPORT_PROJECT_NAME:name},async(url,options)=>{
  if(url.includes('/d1/database?'))return Response.json({success:true,result:[]});
  if(url.endsWith('/pages/projects/'+name)&&options.method==='GET')return Response.json({success:false},{status:404});
  if(url.endsWith('/d1/database'))return Response.json({success:true,result:{uuid:database}});
  if(url.endsWith('/pages/projects'))return Response.json({success:true,result:{subdomain:name+'.pages.dev'}});
  throw new Error('Unexpected provisioning request in local migration check.');
},(path,data)=>files.set(path,data));

mkdirSync('.cloudflare',{recursive:true});
const root=mkdtempSync('.cloudflare/migrations-runtime-');
try{
  const config=JSON.parse(files.get('wrangler.json'));
  config.pages_build_output_dir='../../dist';
  config.d1_databases[0].migrations_dir='../../migrations';
  const options=['--local','--config',join(root,'wrangler.json'),'--persist-to',join(root,'state')];
  writeFileSync(join(root,'wrangler.json'),JSON.stringify(config));
  runWrangler(['d1','migrations','apply','DB',...options]);
  runWrangler(['d1','migrations','apply','DB',...options]);
  const execute=sql=>JSON.parse(runWrangler(['d1','execute','DB',...options,'--command',sql,'--json']));
  const quota=419430400;
  execute(`UPDATE evidence_usage SET bytes=${quota-4} WHERE id=1;
    INSERT INTO evidence_objects (object_key,size,chunks,created_at) VALUES ('quota-boundary',4,1,0);
    INSERT INTO evidence_chunks (object_key,ordinal,data) VALUES ('quota-boundary',0,x'01020304');`);
  const state=()=>execute(`SELECT bytes,
    (SELECT count(*) FROM evidence_objects) AS objects,
    (SELECT count(*) FROM evidence_chunks) AS chunks
    FROM evidence_usage WHERE id=1;`)[0].results[0];
  assert.deepEqual(state(),{bytes:quota,objects:1,chunks:1});
  assert.throws(()=>execute(`INSERT INTO evidence_objects (object_key,size,chunks,created_at)
    VALUES ('over-quota',1,1,0);`),/evidence quota exceeded/);
  assert.deepEqual(state(),{bytes:quota,objects:1,chunks:1},'Rejected uploads cannot reserve storage.');
  execute("DELETE FROM evidence_objects WHERE object_key='quota-boundary';");
  assert.deepEqual(state(),{bytes:quota-4,objects:0,chunks:0},'Deleting an image releases storage and its private chunks.');
  execute("DELETE FROM evidence_objects WHERE object_key='quota-boundary';");
  assert.deepEqual(state(),{bytes:quota-4,objects:0,chunks:0},'Repeated deletion cannot release storage twice.');
  console.log('Cloudflare Wrangler verified migration retries, screenshot quota rejection, rollback and cleanup.');
}finally{rmSync(root,{recursive:true,force:true});}
