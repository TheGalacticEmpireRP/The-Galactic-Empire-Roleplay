export type GmailEnv={GMAIL_SENDER_URL?:string;GMAIL_SENDER_SECRET?:string;EMAIL_FROM?:string};
export function gmailConfigured(env:GmailEnv){
  if(!/^[a-f0-9]{64}$/.test(env.GMAIL_SENDER_SECRET||""))return false;
  try{const u=new URL(env.GMAIL_SENDER_URL||"");return u.origin==="https://script.google.com"&&/^\/macros\/s\/[a-zA-Z0-9_-]{20,}\/exec$/.test(u.pathname)&&!u.search&&!u.hash&&!u.username&&!u.password;}catch{return false;}
}
export async function sendGmail(env:GmailEnv,to:string,subject:string,content:{text:string;html:string},idempotencyKey:string,request:typeof fetch=fetch){
  if(!gmailConfigured(env))throw new Error("gmail_not_configured");
  const from=env.EMAIL_FROM?.trim()||"",sender=(from.match(/<([^<>]+)>$/)?.[1]||from).trim().toLowerCase();
  if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(sender)||/[\r\n]/.test(from))throw new Error("gmail_invalid_sender");
  const payload=JSON.stringify({version:1,idempotencyKey,sentAt:Date.now(),sender,to,subject,...content});
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(env.GMAIL_SENDER_SECRET!),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const signature=[...new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(payload)))].map(n=>n.toString(16).padStart(2,"0")).join("");
  const response=await request(env.GMAIL_SENDER_URL!,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({payload,signature}),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error("gmail_sender_unavailable");
  const result=await response.json() as {ok?:unknown;id?:unknown};
  if(result.ok!==true||typeof result.id!=="string"||!result.id||result.id.length>200)throw new Error("gmail_sender_rejected");
  return result.id;
}
