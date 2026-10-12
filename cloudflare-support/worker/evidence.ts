import {ApiError} from "../lib/validation";
import type {EvidenceBucket} from "../lib/service";
export const CHUNK_SIZE=256*1024;
export const MAX_IMAGE_SIZE=8*1024*1024;

/** Private image chunks fit below D1's per-row and free per-request limits. */
export class D1Evidence implements EvidenceBucket{
  constructor(private db:D1Database){}
  async put(key:string,value:ArrayBuffer){
    if(!value.byteLength||value.byteLength>MAX_IMAGE_SIZE)throw new ApiError(413,"Each image must be 8 MB or smaller.");
    const count=Math.ceil(value.byteLength/CHUNK_SIZE);
    // Recover reservations left by an interrupted upload. Active uploads are untouched.
    await this.db.prepare("DELETE FROM evidence_objects WHERE ready=0 AND created_at < ?").bind(Date.now()-3600_000).run();
    try{
      await this.db.prepare("INSERT INTO evidence_objects (object_key,size,chunks,created_at) VALUES (?,?,?,?)").bind(key,value.byteLength,count,Date.now()).run();
    }catch(e){
      if(String(e).includes("evidence quota exceeded"))throw new ApiError(507,"Screenshot storage is full. Your ticket is saved; use an HTTPS evidence link or contact the owner.");
      throw e;
    }
    try{
      const statements:D1PreparedStatement[]=[];
      for(let i=0;i<count;i++)statements.push(this.db.prepare("INSERT INTO evidence_chunks (object_key,ordinal,data) VALUES (?,?,?)").bind(key,i,value.slice(i*CHUNK_SIZE,(i+1)*CHUNK_SIZE)));
      statements.push(this.db.prepare("UPDATE evidence_objects SET ready=1 WHERE object_key=?").bind(key));
      await this.db.batch(statements);
    }catch(e){await this.delete(key);throw e;}
  }
  async get(key:string){
    const metadata=await this.db.prepare("SELECT chunks FROM evidence_objects WHERE object_key=? AND ready=1").bind(key).first<{chunks:number}>();
    if(!metadata)return null;
    let index=0;
    const db=this.db;
    return {body:new ReadableStream<Uint8Array>({
      async pull(controller){
        if(index>=metadata.chunks){controller.close();return;}
        try{
          const row=await db.prepare("SELECT data FROM evidence_chunks WHERE object_key=? AND ordinal=?").bind(key,index++).first<{data:number[]|ArrayBuffer|Uint8Array}>();
          if(!row)throw new Error("Incomplete screenshot");
          const data=row.data instanceof ArrayBuffer?new Uint8Array(row.data):Uint8Array.from(row.data as ArrayLike<number>);
          controller.enqueue(data);
        }catch(e){controller.error(e);}
      }
    },{highWaterMark:1})};
  }
  async delete(key:string){await this.db.prepare("DELETE FROM evidence_objects WHERE object_key=?").bind(key).run();}
}
