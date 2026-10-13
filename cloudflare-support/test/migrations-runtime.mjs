import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
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
  writeFileSync(join(root,'wrangler.json'),JSON.stringify(config));
  runWrangler(['d1','migrations','apply','DB','--local','--config',join(root,'wrangler.json'),'--persist-to',join(root,'state')]);
  console.log('Cloudflare Wrangler applied both support migrations successfully.');
}finally{rmSync(root,{recursive:true,force:true});}
