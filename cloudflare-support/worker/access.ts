import type {Identity} from "../lib/service";

export type AccessConfig={ACCESS_TEAM?:string;ACCESS_AUD?:string};
type KeyRecord={kid:string;key:CryptoKey};
const decoder=new TextDecoder();
function decode(value:string):Uint8Array<ArrayBuffer>{
  if(!/^[A-Za-z0-9_-]+$/.test(value))throw new Error("Invalid JWT encoding");
  const data=atob(value.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(value.length/4)*4,"="));
  return Uint8Array.from(data,c=>c.charCodeAt(0));
}
function record(value:string){const r=JSON.parse(decoder.decode(decode(value)));if(!r||typeof r!=="object"||Array.isArray(r))throw new Error("Invalid JWT object");return r;}

/** Never use an identity header as authorization. Verify the actual Access signature. */
export function createAccessVerifier(fetchKeys:typeof fetch=fetch){
  let cached:{issuer:string;keys:KeyRecord[];expires:number;lastRefresh:number}|null=null;
  let loading:Promise<void>|null=null;
  async function keys(issuer:string,kid:string):Promise<CryptoKey|null>{
    const time=Date.now();
    const known=cached?.issuer===issuer?cached.keys.find(k=>k.kid===kid):undefined;
    if(known&&cached!.expires>time)return known.key;
    if(cached?.issuer===issuer&&time-cached.lastRefresh<30_000)return null;
    if(!loading)loading=(async()=>{
      // Fixed configured issuer; token-controlled URLs are never fetched.
      const response=await fetchKeys(`${issuer}/cdn-cgi/access/certs`,{signal:AbortSignal.timeout(7000),redirect:"error"});
      if(!response.ok)throw new Error("Access keys unavailable");
      const raw=await response.text();if(raw.length>65536)throw new Error("Access key response too large");
      const jwks=JSON.parse(raw);if(!Array.isArray(jwks.keys)||jwks.keys.length>20)throw new Error("Invalid Access keys");
      const result:KeyRecord[]=[];
      for(const jwk of jwks.keys){
        if(jwk.kty!=="RSA"||typeof jwk.kid!=="string"||(jwk.alg&&jwk.alg!=="RS256")||(jwk.use&&jwk.use!=="sig"))continue;
        const key=await crypto.subtle.importKey("jwk",jwk,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
        result.push({kid:jwk.kid,key});
      }
      cached={issuer,keys:result,expires:Date.now()+300_000,lastRefresh:Date.now()};
    })().finally(()=>{loading=null;});
    await loading;
    return cached?.issuer===issuer?cached.keys.find(k=>k.kid===kid)?.key||null:null;
  }
  return async function verify(request:Request,env:AccessConfig):Promise<Identity|null>{
    try{
      if(!env.ACCESS_TEAM||!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(env.ACCESS_TEAM)||!env.ACCESS_AUD)return null;
      const cookie=request.headers.get("cookie")?.split(";").map(s=>s.trim()).find(s=>s.startsWith("CF_Authorization="))?.slice(17);
      const token=request.headers.get("Cf-Access-Jwt-Assertion")||cookie;
      if(!token||token.length>16_384)return null;
      const parts=token.split(".");if(parts.length!==3)return null;
      const header=record(parts[0]),payload=record(parts[1]);
      if(header.alg!=="RS256"||typeof header.kid!=="string"||header.kid.length>200||header.crit!==undefined)return null;
      const issuer=`https://${env.ACCESS_TEAM}.cloudflareaccess.com`,time=Math.floor(Date.now()/1000);
      const audience=Array.isArray(payload.aud)?payload.aud:[payload.aud];
      if(payload.iss!==issuer||!audience.includes(env.ACCESS_AUD))return null;
      if(!Number.isSafeInteger(payload.exp)||payload.exp<=time||!Number.isSafeInteger(payload.iat)||payload.iat>time+30||payload.iat>=payload.exp)return null;
      if(payload.nbf!==undefined&&(!Number.isSafeInteger(payload.nbf)||payload.nbf>time+30))return null;
      if(typeof payload.sub!=="string"||!payload.sub||payload.sub.length>256||typeof payload.email!=="string"||payload.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email))return null;
      const key=await keys(issuer,header.kid);if(!key)return null;
      const valid=await crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,decode(parts[2]),new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
      return valid?{id:`cf-access:${payload.sub}`,email:payload.email.trim().toLowerCase()}:null;
    }catch{return null;}
  };
}
