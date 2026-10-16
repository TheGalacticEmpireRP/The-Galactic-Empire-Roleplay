import { CATEGORIES, STATUSES, PRIORITIES } from "./content";
import { ApiError, text, optional, oneOf, validateTicket, imageType, notificationEmail } from "./validation";
import {emailConfigured,setTicketEmail,verifyTicketEmail,removeTicketEmail,queueTicketEmail,deliverTicketEmail,ticketEmailStatus,retryTicketEmails,type EmailEnv} from "./email";

export type EvidenceBucket={put(key:string,value:ArrayBuffer,options?:unknown):Promise<unknown>;get(key:string):Promise<{body:ReadableStream<Uint8Array>}|null>;delete(key:string):Promise<unknown>};
type Bindings=EmailEnv&{DB:D1Database;BUCKET?:EvidenceBucket;OWNER_EMAIL?:string;RATE_LIMIT_SECRET?:string};
type Actor={id:string;email:string;alias:string;role:string;categories:string[]};
const allCategories=CATEGORIES.map(c=>c.id);
const uuid=()=>crypto.randomUUID();
const now=()=>Date.now();
export async function digest(value:string){return [...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,"0")).join("");}
export function createKey(){return [...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,"0")).join("");}
function keyEqual(a:string,b:string){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
function json(data:unknown,status=200){return Response.json(data,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"}});}
async function readJson(req:Request){if(!req.headers.get("content-type")?.includes("application/json"))throw new ApiError(415,"Send JSON request data.");const reader=req.body?.getReader();if(!reader)throw new ApiError(400,"Request data is missing.");let size=0;const chunks:Uint8Array[]=[];while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>48000){await reader.cancel();throw new ApiError(413,"Request data is too large.");}chunks.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}try{const value=JSON.parse(new TextDecoder().decode(bytes));if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Invalid object");return value;}catch{throw new ApiError(400,"Invalid request data.");}}
function cleanTicket(t:any){const {access_hash,owner_id,uploads_count,submission_id,...safe}=t;return {...safe,details:JSON.parse(t.details),evidence:JSON.parse(t.evidence)};}

export type Identity={id:string;email:string};
export async function handleSupport(req:Request,env:Bindings,identity:Identity|null=null):Promise<Response>{
 try{
  if(!env.DB)throw new ApiError(503,"Support is temporarily unavailable. Please try again later.");
  const url=new URL(req.url),path=url.pathname.replace(/^\/api\/support\/?/,"").split("/").filter(Boolean);
  if(!["GET","POST","PATCH","DELETE"].includes(req.method))throw new ApiError(405,"Method not allowed.");
  if(req.method!=="GET"&&req.headers.get("origin")!==url.origin)throw new ApiError(403,"Open the support center to perform this action.");
  const db=env.DB,prep=(sql:string,...values:any[])=>db.prepare(sql).bind(...values);
  // Identity is supplied only after signature verification in the Worker.
  const userId=identity?.id||null,email=identity?.email.trim().toLowerCase();
  let actor:Actor|null=null;
  if(userId&&email){
   if(env.OWNER_EMAIL&&email===env.OWNER_EMAIL.trim().toLowerCase())actor={id:userId,email,alias:"Imperial Administration",role:"owner",categories:allCategories};
   else {const s=await prep("SELECT * FROM staff WHERE email = ?",email).first<any>();if(s&&(!s.user_id||s.user_id===userId)){if(!s.user_id)await prep("UPDATE staff SET user_id = ? WHERE email = ? AND user_id IS NULL",userId,email).run();actor={id:userId,email,alias:s.alias,role:s.role,categories:JSON.parse(s.categories)};}}
  }
  const requireStaff=()=>{if(!actor)throw new ApiError(403,"This area is restricted to authorized support staff.");return actor;};
  const requireOwner=()=>{const a=requireStaff();if(a.role!=="owner")throw new ApiError(403,"Only the site owner can manage staff access.");return a;};
  const rate=async(action:string,max:number,seconds:number,identity?:string)=>{
   if(!env.RATE_LIMIT_SECRET)throw new ApiError(503,"Support configuration is incomplete. Please contact the site owner.");
   const ip=identity||req.headers.get("cf-connecting-ip")||"unknown";
   const hashed=await digest(env.RATE_LIMIT_SECRET+":"+ip);const bucket=Math.floor(now()/(seconds*1000));
   const key=`${action}:${hashed}:${bucket}`,expiry=(bucket+1)*seconds*1000;
   const r=await prep("INSERT INTO rate_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count",key,expiry).first<{count:number}>();
   if(!r||r.count>max)throw new ApiError(429,"Too many requests. Please wait before trying again.",Math.ceil((expiry-now())/1000));
  };
  const event=(id:string,label:string,visibility="public",author=actor?.alias||"Member")=>prep("INSERT INTO events (id,ticket_id,label,visibility,actor,created_at) VALUES (?,?,?,?,?,?)",uuid(),id,label,visibility,author,now());
  const access=async(reference:string)=>{
   if(!/^TGE-\d{4}-[A-F0-9]{8}$/.test(reference))throw new ApiError(404,"Ticket not found or access denied.");
   const t=await prep("SELECT * FROM tickets WHERE reference = ?",reference).first<any>();
   if(!t)throw new ApiError(404,"Ticket not found or access denied.");
   const staffAccess=!!actor&&actor.categories.includes(t.category);
   const k=req.headers.get("x-ticket-key")||"";
   const memberAccess=!!userId&&userId===t.owner_id || k.length===64&&keyEqual(await digest(k),t.access_hash);
   if(!staffAccess&&!memberAccess)throw new ApiError(404,"Ticket not found or access denied.");
   return {t,staffAccess,memberAccess};
  };
  if(path[0]==="session"&&req.method==="GET")return json({signedIn:!!userId,staff:actor&&{alias:actor.alias,role:actor.role,email:actor.email,categories:actor.categories},hasAccount:!!userId,emailNotificationsAvailable:emailConfigured(env)});
  if(path[0]==="notifications"&&path[1]==="verify"&&path.length===2&&req.method==="POST"){
   await rate("email-verify",20,300);const b=await readJson(req),token=text(b.token,"Confirmation token",64,64);
   if(!/^[a-f0-9]{64}$/.test(token))throw new ApiError(400,"This confirmation link is invalid or has expired.");
   const result=await verifyTicketEmail(db,token);if(!result)throw new ApiError(400,"This confirmation link has expired or was already used. Open your ticket to request a new one.");
   return json({ok:true,reference:result.reference});
  }
  if(path[0]==="mine"&&req.method==="GET"){
   if(!userId)throw new ApiError(401,"Sign in to view tickets linked to your account.");
   const r=await prep("SELECT reference,category,title,status,created_at,updated_at FROM tickets WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 100",userId).all();return json({items:r.results});
  }
  if(path[0]==="tickets"&&path.length===1&&req.method==="POST"){
   const raw=await readJson(req);if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new ApiError(400,"Invalid ticket data.");
   const requestId=text(raw.requestId,"Submission ID",36,36),key=text(raw.clientKey,"Access key",64,64);
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(requestId)||!/^[a-f0-9]{64}$/.test(key))throw new ApiError(400,"Invalid submission credentials.");
   const hash=await digest(key),existing=await prep("SELECT id,reference,category,access_hash FROM tickets WHERE submission_id=?",requestId).first<any>();
   if(existing){if(!keyEqual(existing.access_hash,hash))throw new ApiError(409,"Submission already exists.");const mail=await ticketEmailStatus(db,env,existing.id,true,false);return json({reference:existing.reference,key,category:existing.category,emailNotification:mail.enabled?"verified":mail.pendingVerification?"pending_verification":"not_enabled"},200);}
   await rate("create",5,3600,userId||undefined);await rate("create-day",20,86400,userId||undefined);
   const data=validateTicket(raw),id=uuid(),reference=`TGE-${new Date().getUTCFullYear()}-${uuid().slice(0,8).toUpperCase()}`,time=now();
   const c=CATEGORIES.find(c=>c.id===data.category)!;
   await db.batch([
    prep("INSERT INTO tickets (id,reference,submission_id,category,title,username,roblox_id,discord,details,evidence,access_hash,owner_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",id,reference,requestId,data.category,data.title,data.username,data.robloxId,data.discord,JSON.stringify(data.details),JSON.stringify(data.evidence),hash,userId,time,time),
    prep("INSERT INTO messages (id,ticket_id,author,author_id,kind,body,created_at) VALUES (?,?,?,?,?,?,?)",uuid(),id,data.username,userId,"member",data.description,time),
    prep("INSERT INTO messages (id,ticket_id,author,kind,body,created_at) VALUES (?,?,?,?,?,?)",uuid(),id,"Support Directorate","system",c.welcome,time+1),
    event(id,"Ticket submitted","public",data.username),
   ]);
   await prep("DELETE FROM rate_limits WHERE expires_at < ?",time-86400000).run();
   let emailNotification:string="not_enabled";
   if(data.notificationEmail){try{emailNotification=await setTicketEmail(db,env,id,reference,data.notificationEmail);}catch{emailNotification="failed";}}
   return json({reference,key,category:data.category,emailNotification},201);
  }
  if(path[0]==="staff"){
   const a=requireStaff();
   if(path[1]==="members"){
    requireOwner();
    if(req.method==="GET")return json({items:(await prep("SELECT email,alias,role,categories,created_at FROM staff ORDER BY alias").all<any>()).results.map(s=>({...s,categories:JSON.parse(s.categories)})),owner:{email:a.email,alias:a.alias}});
    if(req.method==="POST"){
     const b=await readJson(req),e=text(b.email,"Staff email",3,254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))throw new ApiError(400,"Enter a valid staff account email.");if(e===a.email)throw new ApiError(400,"The owner already has administrator access.");
     const alias=text(b.alias,"Staff display name",3,40),role=oneOf(b.role,["support","investigator","admin"],"staff role");
     const cats=role==="support"?["careers","general"]:role==="investigator"?["reports","appeals"]:allCategories;
     await db.batch([prep("INSERT INTO staff (email,alias,role,categories,created_at) VALUES (?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET alias=excluded.alias,role=excluded.role,categories=excluded.categories",e,alias,role,JSON.stringify(cats),now())]);return json({ok:true});
    }
    if(req.method==="DELETE"&&path[2]){const e=decodeURIComponent(path[2]).toLowerCase();if(e===a.email)throw new ApiError(400,"Owner access cannot be removed.");await db.batch([prep("DELETE FROM staff_sessions WHERE email = ?",e),prep("DELETE FROM staff WHERE email = ?",e),prep("UPDATE tickets SET assignee = NULL WHERE assignee = ?",e)]);return json({ok:true});}
   }
   if(path[1]==="tickets"&&req.method==="GET"){
    const allowed=a.categories.filter(c=>allCategories.includes(c as any));if(!allowed.length)return json({items:[],total:0,stats:[],page:1});
    const clauses=[`category IN (${allowed.map(()=>"?").join(",")})`],values:any[]=[...allowed];
    const category=url.searchParams.get("category"),status=url.searchParams.get("status"),q=url.searchParams.get("q")?.trim().slice(0,120),assigned=url.searchParams.get("assigned");
    if(category&&category!=="all"){oneOf(category,allCategories,"category");clauses.push("category = ?");values.push(category);}
    if(status&&status!=="all"){oneOf(status,Object.keys(STATUSES),"status");clauses.push("status = ?");values.push(status);}
    if(q&&new TextEncoder().encode(q).length>48)throw new ApiError(400,"Search must be 48 UTF-8 bytes or shorter.");
    if(q){clauses.push("(title LIKE ? OR username LIKE ? OR reference LIKE ?)");values.push(`%${q}%`,`%${q}%`,`%${q}%`);}
    if(assigned==="mine"){clauses.push("assignee = ?");values.push(a.email);}else if(assigned==="unassigned")clauses.push("assignee IS NULL");
    const page=Math.max(1,Math.min(10000,Number(url.searchParams.get("page"))||1)),where=clauses.join(" AND ");
    const rows=await prep(`SELECT reference,category,title,username,status,priority,assignee,created_at,updated_at,rating FROM tickets WHERE ${where} ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, updated_at DESC LIMIT 20 OFFSET ?`,...values,(Math.floor(page)-1)*20).all();
    const count=await prep(`SELECT count(*) AS total FROM tickets WHERE ${where}`,...values).first<{total:number}>();
    const stats=await prep(`SELECT status,count(*) AS count FROM tickets WHERE category IN (${allowed.map(()=>"?").join(",")}) GROUP BY status`,...allowed).all();
    const members=await prep("SELECT email,alias,role,categories FROM staff ORDER BY alias").all<any>();
    return json({items:rows.results,total:count?.total||0,stats:stats.results,page:Math.floor(page),members:members.results.map(m=>({...m,categories:JSON.parse(m.categories)})),ownerEmail:env.OWNER_EMAIL});
   }
   throw new ApiError(404,"Support action not found.");
  }
  if(path[0]==="tickets"&&path[1]){
   await rate("access",120,300,userId||undefined);
   const {t,staffAccess,memberAccess}=await access(path[1]);
   if(path.length===2&&req.method==="GET"){
    const visibility=staffAccess?"":" AND kind <> 'internal'";
    const msgs=await prep(`SELECT id,author,kind,body,created_at FROM messages WHERE ticket_id = ?${visibility} ORDER BY created_at`,t.id).all();
    const ev=await prep(`SELECT id,label,visibility,actor,created_at FROM events WHERE ticket_id = ?${staffAccess?"":" AND visibility = 'public'"} ORDER BY created_at DESC`,t.id).all();
    const files=await prep("SELECT id,filename,content_type,size,created_at FROM attachments WHERE ticket_id = ? ORDER BY created_at",t.id).all();
    const safe=cleanTicket(t);if(!staffAccess){delete safe.assignee;delete safe.priority;delete safe.discord;delete safe.roblox_id;}
    return json({ticket:safe,messages:msgs.results,events:ev.results,attachments:files.results,staffAccess,memberAccess,emailNotifications:await ticketEmailStatus(db,env,t.id,memberAccess,staffAccess)});
   }
   if(path[2]==="notifications"){
    if(path[3]==="retry"&&path.length===4&&req.method==="POST"){
     if(!staffAccess)throw new ApiError(403,"Staff access is required.");await rate("email-retry",10,3600,actor!.id);
     return json(await retryTicketEmails(db,env,t.id));
    }
    if(path.length!==3)throw new ApiError(404,"Support action not found.");
    if(!memberAccess)throw new ApiError(403,"Only the ticket author can change email alerts.");
    if(req.method==="DELETE"){await removeTicketEmail(db,t.id);return json({ok:true});}
    if(req.method==="POST"){
     const b=await readJson(req),email=notificationEmail(b.email);if(!email)throw new ApiError(400,"Enter your email address.");
     if(!emailConfigured(env))throw new ApiError(503,"Email alerts are awaiting setup. You can still check replies in your ticket.");
     await rate("email-subscribe",3,3600,t.id);
     return json({ok:true,emailNotification:await setTicketEmail(db,env,t.id,t.reference,email)});
    }
   }
   if(path.length===2&&req.method==="PATCH"){
    if(!staffAccess)throw new ApiError(403,"Staff access is required.");const a=requireStaff();await rate("staff-write",160,3600,a.id);const b=await readJson(req),reason=text(b.reason,"Update reason",3,1000);
    const status=b.status===undefined?t.status:oneOf(b.status,Object.keys(STATUSES),"status"),priority=b.priority===undefined?t.priority:oneOf(b.priority,Object.keys(PRIORITIES),"priority");
    let assignee=t.assignee;
    if(b.assignee!==undefined){assignee=b.assignee===null||b.assignee===""?null:text(b.assignee,"Assignee",3,254).toLowerCase();if(assignee&&assignee!==env.OWNER_EMAIL?.toLowerCase()){const s=await prep("SELECT categories FROM staff WHERE email = ?",assignee).first<any>();if(!s||!JSON.parse(s.categories).includes(t.category))throw new ApiError(400,"Choose a reviewer authorized for this category.");}}
    const time=now(),statements=[prep("UPDATE tickets SET status=?,priority=?,assignee=?,updated_at=?,closed_at=? WHERE id=?",status,priority,assignee,time,["resolved","closed"].includes(status)?(t.closed_at||time):null,t.id)];
    if(status!==t.status)statements.push(event(t.id,`${STATUSES[status as keyof typeof STATUSES]} — ${reason}`));
    if(priority!==t.priority)statements.push(event(t.id,`Priority changed to ${priority} — ${reason}`,"staff"));
    if(assignee!==t.assignee)statements.push(event(t.id,assignee?`Assigned to ${assignee} — ${reason}`:`Assignment cleared — ${reason}`,"staff"));
    if(status===t.status&&priority===t.priority&&assignee===t.assignee)throw new ApiError(400,"Choose a change before saving.");
    await db.batch(statements);return json({ok:true});
   }
   if(path[2]==="messages"&&req.method==="POST"){
    const b=await readJson(req),body=text(b.body,"Message",3,6000);await rate("reply",40,3600,staffAccess?actor!.id:t.id);
    const internal=b.internal===true;if(internal&&!staffAccess)throw new ApiError(403,"Staff access is required for private notes.");
    if(!internal&&["resolved","closed"].includes(t.status))throw new ApiError(400,"Reopen the ticket before adding a reply.");
    const time=now(),kind=internal?"internal":staffAccess?"staff":"member",author=staffAccess?actor!.alias:t.username,messageId=uuid();
    const statements=[prep("INSERT INTO messages (id,ticket_id,author,author_id,kind,body,created_at) VALUES (?,?,?,?,?,?,?)",messageId,t.id,author,staffAccess?actor!.id:userId,kind,body,time),prep("UPDATE tickets SET updated_at=? WHERE id=?",time,t.id)];
    if(kind==="staff")statements.push(queueTicketEmail(db,t.id,messageId,time));
    if(!staffAccess&&t.status==="waiting")statements.push(prep("UPDATE tickets SET status='in_review' WHERE id=?",t.id),event(t.id,"Your reply was sent for review","public",t.username));
    await db.batch(statements);return json({ok:true,emailNotification:kind==="staff"?await deliverTicketEmail(db,env,messageId):"not_enabled"},201);
   }
   if(path[2]==="action"&&req.method==="POST"){
    if(!memberAccess)throw new ApiError(403,"Only the ticket author can use this action.");const b=await readJson(req),action=oneOf(b.action,["close","reopen"],"action"),reason=text(b.reason,"Reason",3,1000);await rate("ticket-action",10,3600,t.id);
    if(action==="reopen"&&(!["resolved","closed"].includes(t.status)||!t.closed_at||now()-t.closed_at>14*86400000))throw new ApiError(400,"Reopening is available within 14 days of resolution or closure.");
    if(action==="close"&&t.status==="closed")throw new ApiError(400,"This ticket is already closed.");
    await db.batch([prep("UPDATE tickets SET status=?,updated_at=?,closed_at=? WHERE id=?",action==="close"?"closed":"open",now(),action==="close"?now():null,t.id),event(t.id,`${action==="close"?"Closed":"Reopened"} by member — ${reason}`,"public",t.username)]);return json({ok:true});
   }
   if(path[2]==="feedback"&&req.method==="POST"){
    if(!memberAccess)throw new ApiError(403,"Only the ticket author can leave feedback.");if(!["resolved","closed"].includes(t.status))throw new ApiError(400,"Feedback is available after resolution or closure.");const b=await readJson(req);if(!Number.isInteger(b.rating)||b.rating<1||b.rating>5)throw new ApiError(400,"Choose a rating from 1 to 5.");
    const result=await prep("UPDATE tickets SET rating=?,feedback=? WHERE id=? AND rating IS NULL RETURNING id",b.rating,optional(b.comment,"Feedback",1000),t.id).first();if(!result)throw new ApiError(400,"Feedback has already been submitted.");return json({ok:true});
   }
   if(path[2]==="attachments"){
    if(!env.BUCKET)throw new ApiError(503,"Attachments are temporarily unavailable.");
    if(req.method==="GET"&&path[3]){
     const f=await prep("SELECT * FROM attachments WHERE id=? AND ticket_id=?",path[3],t.id).first<any>();if(!f)throw new ApiError(404,"Attachment not found.");const obj=await env.BUCKET.get(f.object_key);if(!obj)throw new ApiError(404,"Attachment not found.");
     return new Response(obj.body,{headers:{"Content-Type":f.content_type,"Content-Disposition":`attachment; filename="${f.filename.replace(/[^a-zA-Z0-9._-]/g,"_")}"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"sandbox","Referrer-Policy":"no-referrer"}});
    }
    if(req.method==="POST"){
     if(["resolved","closed"].includes(t.status))throw new ApiError(400,"Reopen the ticket before adding evidence.");await rate("upload",15,3600,t.id);
     const length=Number(req.headers.get("content-length"));if(length>8*1024*1024+10000)throw new ApiError(413,"Each image must be 8 MB or smaller.");
     // Bound the streamed multipart body before parsing; an absent length header cannot bypass the limit.
     const reader=req.body?.getReader();if(!reader)throw new ApiError(400,"Choose an image to upload.");let n=0;const chunks:Uint8Array[]=[];while(true){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>8*1024*1024+10000){await reader.cancel();throw new ApiError(413,"Each image must be 8 MB or smaller.");}chunks.push(value);}const bytes=new Uint8Array(n);let pos=0;for(const v of chunks){bytes.set(v,pos);pos+=v.length;}
     let form:FormData;try{form=await new Response(bytes,{headers:{"Content-Type":req.headers.get("content-type")||""}}).formData();}catch{throw new ApiError(400,"Invalid image upload.");}
     const file=form.get("file");if(!(file instanceof File)||file.size<12||file.size>8*1024*1024)throw new ApiError(400,"Choose a PNG, JPEG, or WebP image up to 8 MB.");
     const buffer=await file.arrayBuffer(),type=imageType(new Uint8Array(buffer));if(file.type!==type)throw new ApiError(400,"Image contents do not match the declared file type.");
     const reserved=await prep("UPDATE tickets SET uploads_count=uploads_count+1 WHERE id=? AND uploads_count<5 RETURNING id",t.id).first();if(!reserved)throw new ApiError(400,"This ticket already has five images.");
     const id=uuid(),objectKey=`evidence/${t.id}/${id}`,filename=file.name.replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,120)||"screenshot";
     try{await env.BUCKET.put(objectKey,buffer,{httpMetadata:{contentType:type}});await db.batch([prep("INSERT INTO attachments (id,ticket_id,filename,content_type,size,object_key,created_at) VALUES (?,?,?,?,?,?,?)",id,t.id,filename,type,file.size,objectKey,now()),event(t.id,`Evidence added: ${filename}`,"public",staffAccess?actor!.alias:t.username),prep("UPDATE tickets SET updated_at=? WHERE id=?",now(),t.id)]);}catch(e){await env.BUCKET.delete(objectKey);await prep("UPDATE tickets SET uploads_count=uploads_count-1 WHERE id=?",t.id).run();throw e;}
     return json({ok:true,id},201);
    }
   }
  }
  throw new ApiError(404,"Support action not found.");
 }catch(e){if(e instanceof ApiError){const r=json({error:e.message},e.status);if(e.retryAfter)r.headers.set("Retry-After",String(e.retryAfter));return r;}console.error("Support request failed",e instanceof Error?e.message:"unknown error");return json({error:"Something went wrong. Please retry. Your existing ticket remains saved."},500);}
}

