import {appendFileSync} from 'node:fs';
import {provision} from './provision.mjs';
import {runWrangler} from './wrangler-command.mjs';
import {waitForSupport} from './verify-deployment.mjs';
try{
  const prepared=await provision();
  runWrangler(['d1','migrations','apply','DB','--remote','--config','wrangler.json']);
  runWrangler(['pages','deploy','dist','--project-name',prepared.name,'--branch','main','--commit-dirty=true']);
  console.log(`Upload completed: ${prepared.url}. Waiting for the public site and access checks.`);
  await waitForSupport(prepared.url);
  const text=`Support deployed: ${prepared.url}\n\nBuilt-in staff sign-in is configured. Open ${prepared.url}/staff with your owner email and private access code. Verify owner access before moving existing records.\nExisting website links are retained until ticket migration is complete.\n`;
  console.log(text);
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,text);
}catch(e){console.error(e.message);process.exitCode=1;}
