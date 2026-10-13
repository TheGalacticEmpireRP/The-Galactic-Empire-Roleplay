import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,input} from './service.test.mjs';
import {handleSupport} from '../.checks/lib/service.js';
import {D1Evidence,CHUNK_SIZE} from '../.checks/worker/evidence.js';
import worker from '../.checks/worker/index.js';
import {readReceipts,saveReceipt,forgetReceipt,RECEIPTS_KEY} from '../.checks/lib/receipts.js';
const owner={id:'owner-id',email:'owner@example.test'};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9V8AAAAASUVORK5CYII=','base64');
test('forged platform and Cloudflare email headers cannot grant staff access',async()=>{
  const s=setup(),request=new Request('https://support.test/api/support/staff/tickets',{headers:{'oai-authenticated-user-id':owner.id,'oai-authenticated-user-email':owner.email,'cf-access-authenticated-user-email':owner.email}});
  assert.equal((await handleSupport(request,s.env)).status,403);
  const session=await worker.fetch(new Request('https://support.test/api/support/session',{headers:request.headers}),s.env);
  assert.equal((await session.json()).signedIn,false);
});
test('private D1 screenshots round-trip across chunks and support an 8 MB upload',async()=>{
  const s=setup();s.env.BUCKET=new D1Evidence(s.env.DB);
  const created=await s.send('tickets','POST',input());assert.equal(created.status,201);
  const t=created.data,data=Buffer.alloc(8*1024*1024,0xa7);png.copy(data);
  const form=new FormData();form.append('file',new File([data],'large.png',{type:'image/png'}));
  const upload=await s.send(`tickets/${t.reference}/attachments`,'POST',form,{key:t.key});assert.equal(upload.status,201,JSON.stringify(upload.data));assert.ok(upload.queries<=50,`Upload exceeds free D1 query limit: ${upload.queries}`);
  assert.equal(s.sql.prepare('SELECT count(*) n FROM evidence_chunks').get().n,32);
  assert.equal(s.sql.prepare('SELECT max(length(data)) n FROM evidence_chunks').get().n,CHUNK_SIZE);
  assert.equal(s.sql.prepare('SELECT bytes FROM evidence_usage').get().bytes,data.length);
  assert.equal((await s.send(`tickets/${t.reference}/attachments/${upload.data.id}`)).status,404);
  const downloaded=await s.send(`tickets/${t.reference}/attachments/${upload.data.id}`,'GET',undefined,{key:t.key});
  assert.equal(downloaded.status,200);assert.ok(downloaded.queries<=50,`Download exceeds free D1 query limit: ${downloaded.queries}`);assert.deepEqual(Buffer.from(downloaded.data),data);
});
test('image storage has atomic quota reservations, rollback and idempotent release',async()=>{
  const s=setup(),bucket=new D1Evidence(s.env.DB);
  s.sql.prepare('UPDATE evidence_usage SET bytes=?').run(419430400);
  await assert.rejects(bucket.put('too-large',png.buffer.slice(png.byteOffset,png.byteOffset+png.byteLength)),e=>e.status===507);
  assert.equal(s.sql.prepare('SELECT count(*) n FROM evidence_objects').get().n,0);
  s.sql.prepare('UPDATE evidence_usage SET bytes=0').run();
  const bytes=png.buffer.slice(png.byteOffset,png.byteOffset+png.byteLength);
  await bucket.put('one',bytes);await bucket.delete('one');await bucket.delete('one');
  assert.equal(s.sql.prepare('SELECT bytes FROM evidence_usage').get().bytes,0);
  const failed=new D1Evidence({...s.env.DB,batch:async()=>{throw new Error('simulated D1 interruption');}});
  await assert.rejects(failed.put('failed',bytes));
  assert.equal(s.sql.prepare('SELECT bytes FROM evidence_usage').get().bytes,0);
  s.sql.prepare('INSERT INTO evidence_objects (object_key,size,chunks,created_at) VALUES (?,?,?,?)').run('interrupted',10,1,Date.now()-7200000);
  await bucket.put('next',bytes);assert.equal(s.sql.prepare('SELECT bytes FROM evidence_usage').get().bytes,bytes.byteLength);
});
test('saved receipts are opt-in, validated, private and removable without deleting tickets',()=>{
  const map=new Map(),storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};
  assert.deepEqual(readReceipts(storage),[]);
  const r={reference:'TGE-2026-ABCDEF12',key:'a'.repeat(64),category:'general',title:'A saved support request',savedAt:Date.now()};
  assert.equal(saveReceipt(storage,r).length,1);assert.equal(saveReceipt(storage,r).length,1);
  assert.deepEqual(readReceipts(storage),[r]);assert.deepEqual(forgetReceipt(storage,r.reference),[]);
  map.set(RECEIPTS_KEY,'broken JSON');assert.deepEqual(readReceipts(storage),[]);
  assert.throws(()=>saveReceipt(storage,{...r,key:'invalid'}));
});
test('staff search respects D1 free LIKE pattern byte limit',async()=>{
  const s=setup();assert.equal((await s.send('staff/tickets?q='+encodeURIComponent('a'.repeat(49)),'GET',undefined,{actor:owner})).status,400);
  assert.equal((await s.send('staff/tickets?q='+encodeURIComponent('🙂'.repeat(13)),'GET',undefined,{actor:owner})).status,400);
  assert.equal((await s.send('staff/tickets?q=member','GET',undefined,{actor:owner})).status,200);
});
