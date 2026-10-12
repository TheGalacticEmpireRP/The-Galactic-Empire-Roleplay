import {mkdirSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {cloudflareClient,projectName} from './cloudflare-api.mjs';
export async function provision(env=process.env,request=fetch,write=writeFileSync){
  const api=cloudflareClient(env,request),name=projectName(env.SUPPORT_PROJECT_NAME||'tge-support');
  const owner=env.SUPPORT_OWNER_EMAIL?.trim().toLowerCase();
  if(!owner||owner.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner))throw new Error('Add SUPPORT_OWNER_EMAIL to GitHub Actions secrets. Use the email you will verify for staff sign-in.');
  const team=env.CLOUDFLARE_ACCESS_TEAM||'',aud=env.CLOUDFLARE_ACCESS_AUD||'';
  if(!!team!==!!aud)throw new Error('Set both CLOUDFLARE_ACCESS_TEAM and CLOUDFLARE_ACCESS_AUD after Cloudflare Access setup.');
  if(team&&!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(team))throw new Error('Use only the team name, without https:// or .cloudflareaccess.com.');
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
    OWNER_EMAIL:{type:'secret_text',value:owner},
    RATE_LIMIT_SECRET:{type:'secret_text',value:randomBytes(32).toString('hex')},
    ACCESS_TEAM:{type:'plain_text',value:team},ACCESS_AUD:{type:'plain_text',value:aud}
  };
  const config={compatibility_date:'2026-05-15',fail_open:false,d1_databases:{DB:{id:database.uuid}},env_vars:variables};
  const body={deployment_configs:{production:config,preview:{compatibility_date:'2026-05-15',fail_open:false,d1_databases:{},env_vars:{}}}};
  if(!project)project=await api('pages/projects','POST',{name,production_branch:'main',...body});
  else project=await api(`pages/projects/${name}`,'PATCH',body);
  const subdomain=project.subdomain||`${name}.pages.dev`;
  if(!/^[a-z0-9-]+\.pages\.dev$/.test(subdomain))throw new Error('Cloudflare returned an unexpected production hostname.');
  const wrangler={name,pages_build_output_dir:'./dist',compatibility_date:'2026-05-15',send_metrics:false,
    d1_databases:[{binding:'DB',database_name:`${name}-tickets`,database_id:database.uuid,migrations_dir:'migrations'}],
    vars:{ACCESS_TEAM:team,ACCESS_AUD:aud},env:{preview:{d1_databases:[],vars:{ACCESS_TEAM:'',ACCESS_AUD:''}}}};
  // Only non-secret IDs/configuration go on disk. Owner email and random salt stay in Cloudflare.
  write('wrangler.json',JSON.stringify(wrangler,null,2));
  mkdirSync('.cloudflare',{recursive:true});
  write('.cloudflare/deployment.json',JSON.stringify({name,databaseId:database.uuid,url:`https://${subdomain}`,staffConfigured:!!team}));
  return {name,databaseId:database.uuid,url:`https://${subdomain}`,staffConfigured:!!team};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{const result=await provision();console.log(`Support project prepared: ${result.name}.`);if(!result.staffConfigured)console.log('Staff access remains closed until Cloudflare Access is configured.');}
  catch(e){console.error(e.message);process.exitCode=1;}
}
