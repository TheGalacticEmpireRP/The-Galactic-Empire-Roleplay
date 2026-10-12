import {handleSupport} from "../lib/service";
import {createAccessVerifier,type AccessConfig} from "./access";
import {D1Evidence} from "./evidence";
export type Env=AccessConfig&{DB:D1Database;ASSETS:Fetcher;OWNER_EMAIL?:string;RATE_LIMIT_SECRET?:string};
const verify=createAccessVerifier();
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
      const identity=await verify(request,env);
      return secure(await handleSupport(request,{...env,BUCKET:env.DB?new D1Evidence(env.DB):undefined},identity));
    }
    if(path==="/staff"||path.startsWith("/staff/")){
      if(!await verify(request,env))return secure(new Response("Staff sign-in is required. Open /cdn-cgi/access/login, or ask the owner to complete Cloudflare Access setup.",{status:403,headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"}}));
      const index=new URL("/index.html",request.url);
      const response=await env.ASSETS.fetch(new Request(index,request));
      const result=secure(response);result.headers.set("Cache-Control","private, no-store");return result;
    }
    if(path.startsWith("/api/"))return secure(Response.json({error:"Support action not found."},{status:404}));
    return secure(await env.ASSETS.fetch(request));
  }
};
