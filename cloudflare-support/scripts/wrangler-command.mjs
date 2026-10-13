import {spawnSync} from 'node:child_process';

export function safeDiagnostic(value,environment=process.env){
  let text=String(value||'').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g,'');
  for(const key of ['CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID','SUPPORT_OWNER_EMAIL','SUPPORT_OWNER_LOGIN_CODE','OWNER_LOGIN_HASH','RATE_LIMIT_SECRET']){
    const secret=environment[key];
    if(secret)for(const form of new Set([secret,secret.toLowerCase(),secret.toUpperCase()]))text=text.split(form).join('[redacted]');
  }
  text=text.replace(/(Authorization\s*[:=]\s*(?:Bearer|Basic)\s+)[^\s"']+/gi,'$1[redacted]');
  text=text.replace(/(https?:\/\/[^\s?#]+)\?[^\s]*/g,'$1?[redacted]');
  text=text.replace(/\b[a-f0-9]{64}\b/gi,'[redacted hash]');
  return text.trim().slice(-6000);
}

export function runWrangler(args,{environment=process.env,spawn=spawnSync}={}){
  const result=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],{
    env:{...environment,CI:'true',WRANGLER_SEND_METRICS:'false',WRANGLER_WRITE_LOGS:'false'},
    encoding:'utf8',maxBuffer:8*1024*1024
  });
  if(result.status!==0){
    const diagnostic=safeDiagnostic([result.stdout,result.stderr,result.error?.message].filter(Boolean).join('\n'),environment);
    throw new Error(`Cloudflare deployment step failed: ${args.slice(0,3).join(' ')} (exit ${result.status??'unavailable'}).${diagnostic?'\n'+diagnostic:''}`);
  }
  return result.stdout;
}
