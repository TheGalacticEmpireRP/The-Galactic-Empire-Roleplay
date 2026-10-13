import {appendFileSync} from 'node:fs';
import {provision} from './provision.mjs';
import {runWrangler} from './wrangler-command.mjs';
try{
  const prepared=await provision();
  runWrangler(['d1','migrations','apply','DB','--remote','--config','wrangler.json']);
  runWrangler(['pages','deploy','dist','--project-name',prepared.name,'--branch','main','--commit-dirty=true']);
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
