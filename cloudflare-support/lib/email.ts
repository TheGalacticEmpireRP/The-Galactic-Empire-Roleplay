import {gmailConfigured,sendGmail,type GmailEnv} from "./gmail";
export type EmailEnv=GmailEnv&{RESEND_API_KEY?:string;EMAIL_FROM?:string;SUPPORT_BASE_URL?:string;EMAIL_PROVIDER?:string};
export type EmailResult="sent"|"failed"|"not_enabled"|"pending";
const DAY=86400000;
const token=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,"0")).join("");
const hash=async(s:string)=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)))].map(n=>n.toString(16).padStart(2,"0")).join("");
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
export function emailConfigured(env:EmailEnv){
  if(!env.EMAIL_FROM?.trim()||/[\r\n]/.test(env.EMAIL_FROM))return false;
  if(env.EMAIL_PROVIDER==="gmail"||(!env.EMAIL_PROVIDER&&env.GMAIL_SENDER_URL)){if(!gmailConfigured(env))return false;}
  else if(env.EMAIL_PROVIDER&&env.EMAIL_PROVIDER!=="resend"||!env.RESEND_API_KEY?.trim())return false;
  try{const u=new URL(env.SUPPORT_BASE_URL||"");return u.protocol==="https:"&&!u.username&&!u.password&&u.pathname==="/"&&!u.search&&!u.hash;}catch{return false;}
}
function link(env:EmailEnv,params:Record<string,string>){
  const u=new URL("/",env.SUPPORT_BASE_URL);u.search=new URLSearchParams(params).toString();return u.toString();
}
function render(title:string,reference:string,body:string,url:string,button:string,footer:string){
  const text=`THE GALACTIC EMPIRE — SUPPORT\n\n${title}\nTicket: ${reference}\n\n${body}\n\n${button}: ${url}\n\n${footer}`;
  const html=`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#f3f4f6;font-family:Arial,sans-serif;color:#17202a"><div style="max-width:560px;margin:32px auto;background:white;border-top:4px solid #b42332;padding:32px"><p style="font-size:11px;letter-spacing:2px;color:#7e2630">THE GALACTIC EMPIRE · SUPPORT</p><h1 style="font-size:25px;line-height:1.3">${escape(title)}</h1><p style="font-family:monospace">${escape(reference)}</p><p style="line-height:1.7">${escape(body)}</p><p style="margin:30px 0"><a href="${escape(url)}" style="display:inline-block;background:#b42332;color:white;padding:14px 22px;text-decoration:none;border-radius:4px">${escape(button)}</a></p><p style="font-size:12px;line-height:1.6;color:#586474">${escape(footer)}</p></div></body></html>`;
  return {text,html};
}
async function send(env:EmailEnv,to:string,subject:string,content:{text:string;html:string},idempotencyKey:string,request:typeof fetch=fetch){
  if(!emailConfigured(env))throw new Error("email_not_configured");
  if(env.EMAIL_PROVIDER==="gmail"||(!env.EMAIL_PROVIDER&&env.GMAIL_SENDER_URL))return sendGmail(env,to,subject,content,idempotencyKey,request);
  const response=await request("https://api.resend.com/emails",{
    method:"POST",headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,"Content-Type":"application/json","Idempotency-Key":idempotencyKey},
    body:JSON.stringify({from:env.EMAIL_FROM,to:[to],subject,...content}),signal:AbortSignal.timeout(8000)
  });
  if(!response.ok)throw new Error(`email_provider_${response.status}`);
  const data=await response.json() as {id?:unknown};
  if(typeof data.id!=="string"||!data.id||data.id.length>200)throw new Error("email_provider_invalid_response");
  return data.id;
}

export async function setTicketEmail(db:D1Database,env:EmailEnv,ticketId:string,reference:string,email:string){
  if(!emailConfigured(env))return "unavailable" as const;
  const existing=await db.prepare("SELECT email,verified_at FROM ticket_email_preferences WHERE ticket_id=?").bind(ticketId).first<{email:string;verified_at:number|null}>();
  if(existing?.email===email&&existing.verified_at)return "verified" as const;
  const verification=token(),subscription=crypto.randomUUID(),time=Date.now();
  await db.batch([
    db.prepare("DELETE FROM ticket_email_outbox WHERE ticket_id=? AND status<>'sent'").bind(ticketId),
    db.prepare("INSERT INTO ticket_email_preferences(ticket_id,subscription_id,email,verification_hash,verification_expires_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(ticket_id) DO UPDATE SET subscription_id=excluded.subscription_id,email=excluded.email,verified_at=NULL,verification_hash=excluded.verification_hash,verification_expires_at=excluded.verification_expires_at,updated_at=excluded.updated_at").bind(ticketId,subscription,email,await hash(verification),time+DAY,time)
  ]);
  try{
    await send(env,email,`Confirm TGE ticket email alerts — ${reference}`,render("Confirm your email alerts",reference,
      "You requested an email notification whenever support staff reply to this ticket. Confirm this address to turn on those alerts.",
      link(env,{verifyEmail:verification}),"Confirm email alerts",
      "This link expires in 24 hours. It only enables notifications and does not grant access to the ticket. If you did not request this, ignore this email."),`tge-verify/${subscription}`);
    return "verification_sent" as const;
  }catch{return "failed" as const;}
}

export async function verifyTicketEmail(db:D1Database,verification:string){
  const row=await db.prepare("UPDATE ticket_email_preferences SET verified_at=?,verification_hash=NULL,verification_expires_at=NULL WHERE verification_hash=? AND verification_expires_at>? AND verified_at IS NULL RETURNING ticket_id")
    .bind(Date.now(),await hash(verification),Date.now()).first<{ticket_id:string}>();
  if(!row)return null;
  return db.prepare("SELECT reference FROM tickets WHERE id=?").bind(row.ticket_id).first<{reference:string}>();
}

export async function removeTicketEmail(db:D1Database,ticketId:string){
  await db.batch([db.prepare("DELETE FROM ticket_email_outbox WHERE ticket_id=? AND status<>'sent'").bind(ticketId),db.prepare("DELETE FROM ticket_email_preferences WHERE ticket_id=?").bind(ticketId)]);
}

// Insert this statement in the same D1 transaction as the public staff message.
export function queueTicketEmail(db:D1Database,ticketId:string,messageId:string,time:number){
  return db.prepare("INSERT INTO ticket_email_outbox(message_id,ticket_id,subscription_id,created_at) SELECT ?,ticket_id,subscription_id,? FROM ticket_email_preferences WHERE ticket_id=? AND verified_at IS NOT NULL ON CONFLICT(message_id) DO NOTHING")
    .bind(messageId,time,ticketId);
}

export async function deliverTicketEmail(db:D1Database,env:EmailEnv,messageId:string,request:typeof fetch=fetch):Promise<EmailResult>{
  try{
    const row=await db.prepare("SELECT o.*,p.email,t.reference,m.kind FROM ticket_email_outbox o JOIN ticket_email_preferences p ON p.ticket_id=o.ticket_id AND p.subscription_id=o.subscription_id JOIN tickets t ON t.id=o.ticket_id JOIN messages m ON m.id=o.message_id WHERE o.message_id=? AND p.verified_at IS NOT NULL")
      .bind(messageId).first<{message_id:string;status:string;email:string;reference:string;kind:string;subscription_id:string;created_at:number}>();
    if(!row||row.kind!=="staff")return "not_enabled";
    if(row.status==="sent")return "sent";
    if(row.created_at<Date.now()-23*3600000){await db.prepare("UPDATE ticket_email_outbox SET status='expired' WHERE message_id=? AND status<>'sent'").bind(messageId).run();return "failed";}
    if(!emailConfigured(env)){
      await db.prepare("UPDATE ticket_email_outbox SET status='failed',last_error='email_not_configured' WHERE message_id=? AND status<>'sent'").bind(messageId).run();return "failed";
    }
    const claimed=await db.prepare("UPDATE ticket_email_outbox SET status='sending',attempts=attempts+1,lease_until=? WHERE message_id=? AND attempts<10 AND (status IN ('pending','failed') OR (status='sending' AND lease_until<?)) RETURNING message_id")
      .bind(Date.now()+60000,messageId,Date.now()).first();
    if(!claimed)return row.status==="expired"?"failed":"pending";
    try{
      const providerId=await send(env,row.email,`Support staff replied — ${row.reference}`,render("You have a new support reply",row.reference,
        "Support staff have sent a new reply to your ticket. Open your conversation to read the message and respond.",link(env,{ticket:row.reference}),"View your ticket",
        "Use the private access key from your ticket receipt. Replies, evidence and private access keys are never included in these emails. You can turn off email alerts in your ticket. Reply through the support website; this inbox is not monitored."),`tge-reply/${messageId}/${row.subscription_id}`,request);
      await db.prepare("UPDATE ticket_email_outbox SET status='sent',sent_at=?,provider_id=?,last_error=NULL,lease_until=0 WHERE message_id=?").bind(Date.now(),providerId,messageId).run();
      return "sent";
    }catch{
      await db.prepare("UPDATE ticket_email_outbox SET status='failed',last_error='delivery_failed',lease_until=0 WHERE message_id=? AND status<>'sent'").bind(messageId).run();
      return "failed";
    }
  }catch{
    // Email delivery must never turn an already-saved staff reply into an error.
    console.error("Ticket email delivery could not be completed.");return "failed";
  }
}

export async function ticketEmailStatus(db:D1Database,env:EmailEnv,ticketId:string,member:boolean,staff:boolean){
  const row=await db.prepare("SELECT email,verified_at FROM ticket_email_preferences WHERE ticket_id=?").bind(ticketId).first<{email:string;verified_at:number|null}>();
  const pending=staff?await db.prepare("SELECT count(*) AS n FROM ticket_email_outbox o JOIN ticket_email_preferences p ON p.ticket_id=o.ticket_id AND p.subscription_id=o.subscription_id WHERE o.ticket_id=? AND o.status IN ('pending','failed','sending') AND o.attempts<10 AND o.created_at>?").bind(ticketId,Date.now()-23*3600000).first<{n:number}>():null;
  return {available:emailConfigured(env),enabled:!!row?.verified_at,pendingVerification:!!row&&!row.verified_at,...(member?{email:row?.email||""}:{}),...(staff?{pendingCount:pending?.n||0}:{})};
}

export async function retryTicketEmails(db:D1Database,env:EmailEnv,ticketId:string){
  const rows=await db.prepare("SELECT o.message_id FROM ticket_email_outbox o JOIN ticket_email_preferences p ON p.ticket_id=o.ticket_id AND p.subscription_id=o.subscription_id WHERE o.ticket_id=? AND o.status IN ('pending','failed','sending') AND o.attempts<10 AND o.created_at>? ORDER BY o.created_at LIMIT 3")
    .bind(ticketId,Date.now()-23*3600000).all<{message_id:string}>();
  const results:EmailResult[]=[];
  for(const row of rows.results)results.push(await deliverTicketEmail(db,env,row.message_id));
  return {sent:results.filter(r=>r==="sent").length,failed:results.filter(r=>r!=="sent"&&r!=="not_enabled").length};
}
