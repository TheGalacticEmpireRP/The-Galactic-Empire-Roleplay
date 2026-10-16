import {mkdirSync,writeFileSync} from 'node:fs';
import {randomBytes,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {cloudflareClient,projectName} from './cloudflare-api.mjs';
export async function provision(env=process.env,request=fetch,write=writeFileSync){
  const api=cloudflareClient(env,request),name=projectName(env.SUPPORT_PROJECT_NAME||'tge-support');
  const owner=env.SUPPORT_OWNER_EMAIL?.trim().toLowerCase();
  if(!owner||owner.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner))throw new Error('Add SUPPORT_OWNER_EMAIL to GitHub Actions secrets. Use your staff sign-in email.');
  const ownerCode=env.SUPPORT_OWNER_LOGIN_CODE?.trim().toLowerCase();
  if(!ownerCode||!/^[a-f0-9]{64}$/.test(ownerCode)||new Set(ownerCode).size<8)throw new Error('Add SUPPORT_OWNER_LOGIN_CODE to GitHub Actions secrets. Generate a private random code using owner-code.html; it must contain 64 hexadecimal characters.');
  const resendKey=env.RESEND_API_KEY?.trim(),emailFrom=env.SUPPORT_EMAIL_FROM?.trim();
  if(!!resendKey!==!!emailFrom)throw new Error('Set both RESEND_API_KEY and SUPPORT_EMAIL_FROM in GitHub Actions secrets to enable email alerts.');
  if(emailFrom&&(!/^[^\r\n]+$/.test(emailFrom)||emailFrom.length>320||!/@[^\s<>]+\.[^\s<>]+/.test(emailFrom)))throw new Error('SUPPORT_EMAIL_FROM must be a verified sender address, optionally with a display name.');
  const ownerHash=createHash('sha256').update(`tge-staff-code:v1:${owner}:${ownerCode}`).digest('hex');
  let database=null;
  for(let page=1;page<=10;page++){
    const list=await api(`d1/database?per_page=100&page=${page}`);
    database=list.find(d=>d.name===`${name}-tickets`)||null;
    if(database||list.length<100)break;
  }
  let project=await api(`pages/projects/${name}`,'GET',undefined,true);
  if(project&&(!database||project.deployment_configs?.production?.d1_databases?.DB?.id!==database.uuid))throw new Error('This Cloudflare Pages name belongs to another project. Choose a different support project name.');
  if(!database)database=await api('d1/database','POST',{name:`${name}-tickets`,primary_location_hint:'weur'});
  if(!database?.uuid||!/^[a-f0-9-]{36}$/i.test(database.uuid))throw new Error('Cloudflare did not return a valid database ID.');
  const variables={
    ...(project?.deployment_configs?.production?.env_vars||{}),
    SUPPORT_BASE_URL:{type:'plain_text',value:`https://${name}.pages.dev`},
    ...(resendKey?{RESEND_API_KEY:{type:'secret_text',value:resendKey},EMAIL_FROM:{type:'secret_text',value:emailFrom}}:{}),
    OWNER_EMAIL:{type:'secret_text',value:owner},
    RATE_LIMIT_SECRET:{type:'secret_text',value:randomBytes(32).toString('hex')},
    OWNER_LOGIN_HASH:{type:'secret_text',value:ownerHash}
  };
  const config={compatibility_date:'2026-05-15',fail_open:false,d1_databases:{DB:{id:database.uuid}},env_vars:variables};
  const body={deployment_configs:{production:config,preview:{compatibility_date:'2026-05-15',fail_open:false,d1_databases:{},env_vars:{}}}};
  if(!project)project=await api('pages/projects','POST',{name,production_branch:'main',...body});
  else project=await api(`pages/projects/${name}`,'PATCH',body);
  const subdomain=project.subdomain||`${name}.pages.dev`;
  if(!/^[a-z0-9-]+\.pages\.dev$/.test(subdomain))throw new Error('Cloudflare returned an unexpected production hostname.');
  const wrangler={name,pages_build_output_dir:'./dist',compatibility_date:'2026-05-15',send_metrics:false,
    d1_databases:[{binding:'DB',database_name:`${name}-tickets`,database_id:database.uuid,migrations_dir:'migrations'}],
    vars:{},env:{preview:{d1_databases:[],vars:{}}}};
  // Only non-secret IDs/configuration go on disk. Owner email and random salt stay in Cloudflare.
  write('wrangler.json',JSON.stringify(wrangler,null,2));
  mkdirSync('.cloudflare',{recursive:true});
  write('.cloudflare/deployment.json',JSON.stringify({name,databaseId:database.uuid,url:`https://${subdomain}`,staffConfigured:true}));
  return {name,databaseId:database.uuid,url:`https://${subdomain}`,staffConfigured:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{const result=await provision();console.log(`Support project prepared: ${result.name}. Built-in staff sign-in is configured.`);}
  catch(e){console.error(e.message);process.exitCode=1;}
}

