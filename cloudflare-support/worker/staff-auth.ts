import {digest,createKey,type Identity} from "../lib/service";
import {ApiError} from "../lib/validation";

export type StaffAuthEnv={DB:D1Database;OWNER_EMAIL?:string;OWNER_LOGIN_HASH?:string;RATE_LIMIT_SECRET?:string};
export const STAFF_COOKIE="__Host-tge_staff";
const lifetime=8*3600_000;
const codePattern=/^[a-f0-9]{64}$/;
type Credential={email:string;identity_id:string;code_hash:string;version:string};
type Session={email:string;identity_id:string;credential_version:string;last_seen_at:number;expires_at:number};
const emailValue=(value:unknown)=>typeof value==="string"?value.trim().toLowerCase():"";
const validEmail=(value:string)=>value.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export const hashStaffCode=(email:string,code:string)=>digest(`tge-staff-code:v1:${emailValue(email)}:${code.trim().toLowerCase()}`);
function equal(a:string,b:string){if(a.length!==b.length)return false;let difference=0;for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);return difference===0;}
const cookie=(value:string,age=28800)=>`${STAFF_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
function json(body:unknown,status=200,setCookie?:string){const headers=new Headers({"Cache-Control":"no-store","Content-Type":"application/json"});if(setCookie)headers.set("Set-Cookie",setCookie);return new Response(JSON.stringify(body),{status,headers});}
async function body(request:Request){
  if(!request.headers.get("content-type")?.includes("application/json"))throw new ApiError(415,"Send JSON request data.");
  const reader=request.body?.getReader();if(!reader)throw new ApiError(400,"Request data is missing.");
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>3000){await reader.cancel();throw new ApiError(413,"Sign-in request is too large.");}chunks.push(item.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength;}
  try{const value=JSON.parse(new TextDecoder().decode(bytes));if(!value||typeof value!=="object"||Array.isArray(value))throw new Error();return value;}catch{throw new ApiError(400,"Invalid request data.");}
}

// Codes are generated random 256-bit credentials, not human-chosen passwords.
// The browser receives a separate random session token; D1 stores its hash only.
export function createStaffAuth(request:Request,env:StaffAuthEnv){
  const owner=emailValue(env.OWNER_EMAIL),ownerHash=env.OWNER_LOGIN_HASH||"";
  const configured=validEmail(owner)&&codePattern.test(ownerHash)&&!!env.RATE_LIMIT_SECRET;
  const rawCookie=request.headers.get("cookie")||"";
  const cookies=rawCookie.length<=8192?rawCookie.split(";").map(part=>part.trim()).filter(part=>part.startsWith(STAFF_COOKIE+"=")):[];
  const token=cookies.length===1?cookies[0].slice(STAFF_COOKIE.length+1):"";
  const hadCookie=cookies.length>0||rawCookie.length>8192;
  let invalidCookie=false,identityPromise:Promise<Identity|null>|undefined;
  const prep=(sql:string,...values:any[])=>env.DB.prepare(sql).bind(...values);
  async function credential(email:string):Promise<Credential|null>{
    if(!configured)return null;
    if(email===owner)return {email,identity_id:"native-owner:"+await digest(owner),code_hash:ownerHash,version:await digest("owner:"+ownerHash)};
    const row=await prep("SELECT c.email,c.identity_id,c.code_hash,s.user_id,s.role,s.categories FROM staff_login_credentials c JOIN staff s ON s.email=c.email WHERE c.email=?",email).first<any>();
    if(!row||!codePattern.test(row.code_hash)||row.user_id&&row.user_id!==row.identity_id)return null;
    return {...row,version:await digest(`staff:${row.code_hash}:${row.role}:${row.categories}`)};
  }
  async function loadIdentity():Promise<Identity|null>{
    if(!hadCookie)return null;
    if(!configured||!env.DB||!codePattern.test(token)){invalidCookie=true;return null;}
    const hash=await digest(token),session=await prep("SELECT email,identity_id,credential_version,last_seen_at,expires_at FROM staff_sessions WHERE token_hash=?",hash).first<Session>();
    const time=Date.now(),current=session&&session.expires_at>time&&session.last_seen_at>time-1800_000?await credential(session.email):null;
    if(!session||!current||!equal(session.credential_version,current.version)||session.identity_id!==current.identity_id){
      invalidCookie=true;await prep("DELETE FROM staff_sessions WHERE token_hash=?",hash).run();return null;
    }
    if(session.last_seen_at<time-60000)await prep("UPDATE staff_sessions SET last_seen_at=? WHERE token_hash=?",time,hash).run();
    return {id:current.identity_id,email:current.email};
  }
  const identity=()=>identityPromise??=loadIdentity();
  async function rate(kind:string,value:string,max:number){
    const now=Date.now(),period=900_000,slot=Math.floor(now/period),expiry=(slot+1)*period;
    const key=`staff-auth:${kind}:${await digest(env.RATE_LIMIT_SECRET+":"+value)}:${slot}`;
    const row=await prep("INSERT INTO rate_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count",key,expiry).first<{count:number}>();
    if(!row||row.count>max)throw new ApiError(429,"Too many sign-in attempts. Please wait and try again.",Math.max(1,Math.ceil((expiry-now)/1000)));
  }
  async function handle():Promise<Response>{
    try{
      if(request.method!=="POST")throw new ApiError(405,"Method not allowed.");
      if(request.headers.get("origin")!==new URL(request.url).origin)throw new ApiError(403,"Open the support website to perform this action.");
      if(!env.DB)throw new ApiError(503,"Staff sign-in is temporarily unavailable.");
      const action=new URL(request.url).pathname.replace(/^\/api\/support\/auth\//,"");
      if(action==="logout"){
        if(codePattern.test(token))await prep("DELETE FROM staff_sessions WHERE token_hash=?",await digest(token)).run();
        return json({ok:true},200,cookie("",0));
      }
      if(!configured)throw new ApiError(503,"The owner must finish staff sign-in setup. Member support is still available.");
      if(action==="login"){
        await rate("ip",request.headers.get("cf-connecting-ip")||"unknown",20);
        const data=await body(request),email=emailValue(data.email),code=typeof data.code==="string"?data.code.trim().toLowerCase():"";
        if(!validEmail(email))throw new ApiError(401,"Email or access code is incorrect.");
        await rate("email",email,15);
        const candidate=await hashStaffCode(email,codePattern.test(code)?code:"invalid");
        const current=await credential(email);
        if(!codePattern.test(code)||!equal(candidate,current?.code_hash||"0".repeat(64))||!current)throw new ApiError(401,"Email or access code is incorrect.");
        const now=Date.now(),sessionToken=createKey();
        await env.DB.batch([
          prep("DELETE FROM staff_sessions WHERE expires_at<=?",now),
          prep("DELETE FROM staff_sessions WHERE email=? AND token_hash IN (SELECT token_hash FROM staff_sessions WHERE email=? ORDER BY issued_at DESC,token_hash DESC LIMIT -1 OFFSET 4)",email,email),
          prep("INSERT INTO staff_sessions (token_hash,email,identity_id,credential_version,issued_at,last_seen_at,expires_at) VALUES (?,?,?,?,?,?,?)",await digest(sessionToken),email,current.identity_id,current.version,now,now,now+lifetime),
          prep("DELETE FROM rate_limits WHERE expires_at<?",now)
        ]);
        return json({ok:true},200,cookie(sessionToken));
      }
      const actor=await identity();if(!actor)throw new ApiError(401,"Your staff session has expired. Sign in again.");
      if(action==="logout-all"){
        await prep("DELETE FROM staff_sessions WHERE email=?",actor.email).run();return json({ok:true},200,cookie("",0));
      }
      if(action==="staff-code"){
        if(actor.email!==owner)throw new ApiError(403,"Only the owner can create staff sign-in codes.");
        const data=await body(request),email=emailValue(data.email);
        if(!validEmail(email)||email===owner)throw new ApiError(400,"Choose a reviewer from your staff roster.");
        await rate("issue",owner,30);
        const staff=await prep("SELECT email FROM staff WHERE email=?",email).first();
        if(!staff)throw new ApiError(400,"Add the reviewer to Staff access first.");
        const existing=await prep("SELECT identity_id FROM staff_login_credentials WHERE email=?",email).first<{identity_id:string}>();
        const id=existing?.identity_id||"native-staff:"+crypto.randomUUID(),code=createKey(),time=Date.now();
        await env.DB.batch([
          prep("INSERT INTO staff_login_credentials (email,identity_id,code_hash,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash,updated_at=excluded.updated_at",email,id,await hashStaffCode(email,code),time,time),
          prep("UPDATE staff SET user_id=? WHERE email=?",id,email),
          prep("DELETE FROM staff_sessions WHERE email=?",email)
        ]);
        return json({email,code});
      }
      throw new ApiError(404,"Sign-in action not found.");
    }catch(error){
      const known=error instanceof ApiError,response=json({error:known?error.message:"Staff sign-in is temporarily unavailable."},known?error.status:503);
      if(known&&error.retryAfter)response.headers.set("Retry-After",String(error.retryAfter));
      if(invalidCookie)response.headers.set("Set-Cookie",cookie("",0));
      return response;
    }
  }
  return {identity,handle,configured,hadCookie,clearInvalidCookie(response:Response){if(invalidCookie)response.headers.set("Set-Cookie",cookie("",0));return response;}};
}
