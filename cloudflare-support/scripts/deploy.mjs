import {spawnSync} from 'node:child_process';
import {readFileSync,appendFileSync} from 'node:fs';
import {provision} from './provision.mjs';
function cli(args){
  const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],{
    env:{...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_WRITE_LOGS:'false'},encoding:'utf8',maxBuffer:8*1024*1024
  });
  if(result.status!==0)throw new Error(`Cloudflare deployment step failed: ${args.slice(0,3).join(' ')}. Check the API token permissions and database settings.`);
}
try{
  const prepared=await provision();
  cli(['d1','migrations','apply','DB','--remote','--config','wrangler.json']);
  cli(['pages','deploy','dist','--project-name',prepared.name,'--branch','main','--commit-dirty=true']);
  // Verify public endpoints after deployment. No sample ticket is left in the live database.
  const response=await fetch(`${prepared.url}/api/support/session`,{signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error('Deployment completed, but the support API did not pass its public health check. Keep the existing support links.');
  const session=await response.json();
  if(session.staff||session.signedIn)throw new Error('Anonymous access verification failed. Keep the existing support links.');
  const forbidden=await fetch(`${prepared.url}/api/support/staff/tickets`,{signal:AbortSignal.timeout(30000)});
  if(forbidden.status!==403)throw new Error('Staff access verification failed. Keep the existing support links.');
  const text=`Support deployed: ${prepared.url}\n\n${prepared.staffConfigured?'Staff sign-in is configured. Verify it before moving existing records.':'Next: configure Cloudflare Access for /staff, then rerun deployment.'}\nExisting website links are retained until ticket migration is complete.\n`;
  console.log(text);
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,text);
}catch(e){console.error(e.message);process.exitCode=1;}
