import { CATEGORIES, type CategoryId } from "./content";
export class ApiError extends Error { constructor(public status:number,message:string,public retryAfter?:number){super(message);} }
export function text(value:unknown,label:string,min=0,max=1000){if(typeof value!=="string")throw new ApiError(400,`${label} is required.`);const s=value.trim();if(s.length<min||s.length>max)throw new ApiError(400,`${label} must contain ${min}–${max} characters.`);return s;}
export function optional(value:unknown,label:string,max=1000){return value==null||value===""?"":text(value,label,0,max);}
export function oneOf(value:unknown,values:readonly string[],label:string){if(typeof value!=="string"||!values.includes(value))throw new ApiError(400,`Choose a valid ${label}.`);return value;}
export function validateTicket(raw:any){
 if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new ApiError(400,"Invalid ticket data.");
 if(raw.website)throw new ApiError(400,"Unable to submit this request.");
 if(raw.consent!==true)throw new ApiError(400,"Confirm that your information is accurate before sending.");
 const category=oneOf(raw.category,CATEGORIES.map(c=>c.id),"category") as CategoryId;
 const username=text(raw.username,"Roblox username",3,20);if(!/^[A-Za-z0-9_]+$/.test(username))throw new ApiError(400,"Use your Roblox username, with letters, numbers, and underscores only.");
 const robloxId=optional(raw.robloxId,"Roblox user ID",20);if(robloxId&&!/^\d+$/.test(robloxId))throw new ApiError(400,"Roblox user ID must contain numbers only.");
 const title=text(raw.title,"Subject",8,120),description=text(raw.description,"Description",30,6000),discord=optional(raw.discord,"Discord username",80);
 const d=raw.details;if(!d||typeof d!=="object"||Array.isArray(d))throw new ApiError(400,"Complete the category questions.");
 let details:Record<string,string>={};
 if(category==="careers")details={position:oneOf(d.position,["Support Staff","Officer Academy","Division Leadership","Other"],"role"),division:optional(d.division,"Division",80),timezone:text(d.timezone,"Timezone",2,80),availability:text(d.availability,"Availability",8,400),experience:text(d.experience,"Experience",30,2500),motivation:text(d.motivation,"Motivation",30,2500)};
 if(category==="reports"){
  const incidentAt=text(d.incidentAt,"Incident date",10,40);if(!Number.isFinite(Date.parse(incidentAt))||Date.parse(incidentAt)>Date.now()+300000)throw new ApiError(400,"Enter a valid incident date that is not in the future.");
  const reportedUsername=text(d.reportedUsername,"Reported username",3,80);
  details={reportType:oneOf(d.reportType,["Staff report","Member report"],"report type"),reportedUsername,location:oneOf(d.location,["Game","Discord","Both"],"platform"),incidentAt,ruleBroken:text(d.ruleBroken,"Rule or conduct involved",8,1500),witnesses:optional(d.witnesses,"Witnesses",500)};
 }
 if(category==="general")details={topic:oneOf(d.topic,["Technical issue","Account & access","Ranks / XP / morphs","Rules & gameplay","Other"],"topic"),platform:oneOf(d.platform,["PC","Mobile","Console","Roblox Studio","Discord / Website"],"platform"),reproduction:optional(d.reproduction,"Steps to reproduce",2000),expected:optional(d.expected,"Expected result",1000),tried:optional(d.tried,"Previous attempts",1000)};
 if(category==="appeals"){
  const sanctionAt=optional(d.sanctionAt,"Sanction date",40);if(sanctionAt&&(!Number.isFinite(Date.parse(sanctionAt))||Date.parse(sanctionAt)>Date.now()+300000))throw new ApiError(400,"Enter a valid sanction date.");
  details={sanction:oneOf(d.sanction,["Ban","Blacklist","Warning","Demotion","Other"],"sanction"),sanctionAt,reference:optional(d.reference,"Sanction reference",100),issuedBy:optional(d.issuedBy,"Issued by",80),reasonSanction:text(d.reasonSanction,"Original reason",8,1500),whyReview:text(d.whyReview,"Reason for review",30,2500),changedSince:text(d.changedSince,"Changes or new context",30,2500)};
 }
 if(!Array.isArray(raw.evidence)||raw.evidence.length>5)throw new ApiError(400,"Include at most five evidence links.");
 const evidence=raw.evidence.filter((x:unknown)=>x!=="").map((x:unknown)=>{const s=text(x,"Evidence link",8,1500);let u:URL;try{u=new URL(s);}catch{throw new ApiError(400,"Use a full HTTPS evidence link.");}if(u.protocol!=="https:"||u.username||u.password)throw new ApiError(400,"Evidence links must use HTTPS and contain no embedded credentials.");return u.toString();});
 return {category,username,robloxId,title,description,discord,details,evidence};
}
export function imageType(bytes:Uint8Array){if(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10)return "image/png";if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return "image/jpeg";if(new TextDecoder().decode(bytes.slice(0,4))==="RIFF"&&new TextDecoder().decode(bytes.slice(8,12))==="WEBP")return "image/webp";throw new ApiError(400,"Upload a PNG, JPEG, or WebP image. The file contents must match its type.");}
