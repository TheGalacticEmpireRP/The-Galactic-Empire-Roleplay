import {handleSupport} from "../lib/service";
import {createStaffAuth,type StaffAuthEnv} from "./staff-auth";
import {D1Evidence} from "./evidence";
export type Env=StaffAuthEnv&{ASSETS:Fetcher};
const secure=(response:Response)=>{
  const result=new Response(response.body,response);
  result.headers.set("X-Content-Type-Options","nosniff");
  result.headers.set("Referrer-Policy","no-referrer");
  result.headers.set("Permissions-Policy","camera=(), microphone=(), geolocation=()");
  if(result.headers.get("Content-Type")?.includes("text/html"))result.headers.set("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  return result;
};
export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    const path=new URL(request.url).pathname;
    if(path==="/api/support"||path.startsWith("/api/support/")){
      const auth=createStaffAuth(request,env);
      if(path.startsWith("/api/support/auth/"))return secure(await auth.handle());
      try{
        const identity=await auth.identity();
        if(path.startsWith("/api/support/staff/")&&auth.hadCookie&&!identity)return secure(auth.clearInvalidCookie(Response.json({error:"Your staff session has expired. Sign in again."},{status:401,headers:{"Cache-Control":"no-store"}})));
        let response=await handleSupport(request,{...env,BUCKET:env.DB?new D1Evidence(env.DB):undefined},identity);
        if(path==="/api/support/session"&&response.ok){
          const session=await response.json() as Record<string,unknown>;
          response=Response.json({...session,auth:{type:"staff-code",ownerConfigured:auth.configured}},{headers:{"Cache-Control":"no-store"}});
        }
        return secure(auth.clearInvalidCookie(response));
      }catch{return secure(Response.json({error:"Support is temporarily unavailable."},{status:503,headers:{"Cache-Control":"no-store"}}));}
    }
    if(path==="/staff"||path.startsWith("/staff/")){
      const index=new URL("/index.html",request.url);
      const response=await env.ASSETS.fetch(new Request(index,request));
      const result=secure(response);result.headers.set("Cache-Control","private, no-store");return result;
    }
    if(path.startsWith("/api/"))return secure(Response.json({error:"Support action not found."},{status:404}));
    return secure(await env.ASSETS.fetch(request));
  }
};
