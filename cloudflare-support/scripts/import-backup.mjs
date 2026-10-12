import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {cloudflareClient} from './cloudflare-api.mjs';
const columns={
  tickets:['id','reference','submission_id','category','title','username','roblox_id','discord','details','evidence','access_hash','owner_id','status','priority','assignee','created_at','updated_at','closed_at','uploads_count','rating','feedback'],
  messages:['id','ticket_id','author','author_id','kind','body','created_at'],
  events:['id','ticket_id','label','visibility','actor','created_at'],
  staff:['email','user_id','alias','role','categories','created_at']
};
export function validateBackup(backup){
  if(backup?.format!=='tge-support-backup-v1'||backup.complete!==true||!backup.tables)throw new Error('Use a complete, untruncated support backup.');
  for(const table of ['tickets','messages','events','attachments','staff'])if(!Array.isArray(backup.tables[table]))throw new Error(`The backup is missing ${table}.`);
  if(backup.tables.attachments.length)throw new Error('This backup contains screenshots. Transfer and verify all image bytes before importing; this record-only import refuses to lose attachments.');
  for(const [table,names] of Object.entries(columns)){
    if(backup.tables[table].length>10000)throw new Error('The backup is too large for this import; use a database export.');
    for(const row of backup.tables[table])for(const name of names){
      if(!(name in row))throw new Error(`Incomplete ${table} record.`);
      if(row[name]!==null&&typeof row[name]!=='string'&&(!Number.isSafeInteger(row[name])))throw new Error(`Invalid ${table} record.`);
    }
  }
  for(const ticket of backup.tables.tickets){
    if(!/^TGE-\d{4}-[A-F0-9]{8}$/.test(ticket.reference)||!/^[a-f0-9]{64}$/.test(ticket.access_hash)||ticket.uploads_count!==0)throw new Error('The backup contains an invalid ticket or a pending image upload.');
  }
  return backup;
}
function literal(value){
  if(value===null)return 'NULL';
  if(typeof value==='number')return String(value);
  // A fixed column list and quoted literals prevent SQL injection from ticket text.
  return "'"+value.replaceAll("'","''")+"'";
}
export function importStatements(raw){
  const backup=validateBackup(raw),statements=[];
  for(const [table,names] of Object.entries(columns))for(const original of backup.tables[table]){
    const row={...original};
    // ChatGPT account IDs cannot authorize Cloudflare users. Receipts retain their exact key hash.
    if(table==='tickets')row.owner_id=null;
    if(table==='staff')row.user_id=null;
    const primary=table==='staff'?'email':'id';
    const sql=`INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(n=>literal(row[n])).join(',')}) ON CONFLICT(${primary}) DO NOTHING`;
    if(Buffer.byteLength(sql)>90_000)throw new Error('A support record exceeds D1 statement limits.');
    statements.push({sql});
  }
  return statements;
}
export async function importBackup(backup,databaseId,api){
  if(!/^[a-f0-9-]{36}$/i.test(databaseId))throw new Error('Use the database ID returned by deployment.');
  const statements=importStatements(backup);
  for(let i=0;i<statements.length;i+=40){
    const result=await api(`d1/database/${databaseId}/query`,'POST',{batch:statements.slice(i,i+40)});
    if(!Array.isArray(result)||result.some(r=>r.success===false))throw new Error('A backup batch failed. Keep the original portal available.');
  }
  // Verify the imported ticket keys and record identity, not just a row count.
  for(const [table,names] of Object.entries(columns)){
    const primary=table==='staff'?'email':'id';
    for(const source of backup.tables[table]){
      const result=await api(`d1/database/${databaseId}/query`,'POST',{sql:`SELECT ${names.join(',')} FROM ${table} WHERE ${primary}=${literal(source[primary])}`});
      const found=result?.[0]?.results?.[0];
      if(!found||names.some(n=>found[n]!==((table==='staff'&&n==='user_id'||table==='tickets'&&n==='owner_id')?null:source[n])))throw new Error('Imported records differ from the backup. Keep the original portal available.');
    }
  }
  return {tickets:backup.tables.tickets.length,messages:backup.tables.messages.length,events:backup.tables.events.length,staff:backup.tables.staff.length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(!process.argv[2])throw new Error('Pass a private support backup JSON path. Never commit it to GitHub.');
    const backup=JSON.parse(readFileSync(process.argv[2],'utf8'));
    const config=JSON.parse(readFileSync('.cloudflare/deployment.json','utf8'));
    const counts=await importBackup(backup,config.databaseId,cloudflareClient());
    console.log(`Import verified: ${counts.tickets} tickets, ${counts.messages} messages, ${counts.events} history entries, ${counts.staff} staff entries. Verify receipt access and staff sign-in before switching public links.`);
  }catch(e){console.error(e.message);process.exitCode=1;}
}
