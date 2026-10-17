import {CATEGORIES} from "./content";

const communityOrigin="https://thegalacticempirerp.github.io";

// Public directory only. This endpoint never reads cookies, tickets, or the database.
export function publicSupportInfo(request:Request):Response {
  const headers=new Headers({
    "Cache-Control":"public, max-age=300, s-maxage=300",
    "Vary":"Origin",
    "X-Content-Type-Options":"nosniff",
  });
  if(request.headers.get("Origin")===communityOrigin)headers.set("Access-Control-Allow-Origin",communityOrigin);
  if(!["GET","HEAD"].includes(request.method)) {
    headers.set("Allow","GET, HEAD");
    headers.set("Cache-Control","no-store");
    return Response.json({error:"Method not allowed."},{status:405,headers});
  }
  const directory={
    service:"tge-support",version:1,
    categories:CATEGORIES.map(({id,name,description})=>({id,name,description,url:`/?category=${id}`})),
    links:{home:"/",track:"/?view=track",guides:"/?view=guides",staff:"/staff"},
  };
  const response=Response.json(directory,{headers});
  return request.method==="HEAD"?new Response(null,{status:200,headers:response.headers}):response;
}
