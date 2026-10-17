import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicSupportInfo} from '../.checks/lib/public-info.js';
import {CATEGORIES} from '../.checks/lib/content.js';
import worker from '../.checks/worker/index.js';

const origin='https://thegalacticempirerp.github.io';
const endpoint='https://support.test/api/support/public-info';

test('community integration returns only public category details and relative support links',async()=>{
  const response=publicSupportInfo(new Request(endpoint,{headers:{Origin:origin}}));
  assert.equal(response.status,200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);
  assert.equal(response.headers.get('Access-Control-Allow-Credentials'),null);
  assert.equal(response.headers.get('Vary'),'Origin');
  const data=await response.json();
  assert.deepEqual(Object.keys(data).sort(),['categories','links','service','version']);
  assert.equal(data.service,'tge-support');
  assert.equal(data.version,1);
  assert.deepEqual(data.categories,CATEGORIES.map(({id,name,description})=>({id,name,description,url:`/?category=${id}`})));
  assert.deepEqual(data.links,{home:'/',track:'/?view=track',guides:'/?view=guides',staff:'/staff'});
  assert.match(response.headers.get('Cache-Control'),/public/);
});
test('public directory does not allow other origins to read it through CORS',()=>{
  for(const other of ['https://other.example','https://thegalacticempirerp.github.io.evil.example','null','']){
    const response=publicSupportInfo(new Request(endpoint,{headers:other?{Origin:other}:{}}));
    assert.equal(response.status,200);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);
  }
});
test('public directory refuses writes and supports a bodyless HEAD request',async()=>{
  for(const method of ['POST','PATCH','DELETE','OPTIONS']){
    const response=publicSupportInfo(new Request(endpoint,{method}));
    assert.equal(response.status,405);
    assert.equal(response.headers.get('Allow'),'GET, HEAD');
  }
  const head=publicSupportInfo(new Request(endpoint,{method:'HEAD'}));
  assert.equal(head.status,200);
  assert.equal(await head.text(),'');
});
test('worker serves the directory without database or staff authentication and ignores supplied credentials',async()=>{
  const response=await worker.fetch(new Request(endpoint,{headers:{Origin:origin,Cookie:'tge-staff-session=untrusted','X-Ticket-Key':'untrusted'}}),{});
  assert.equal(response.status,200);
  assert.equal(response.headers.get('Set-Cookie'),null);
  assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
  const data=await response.json();
  assert.equal(data.staff,undefined);
  assert.equal(data.tickets,undefined);
  assert.equal(data.categories.length,4);
});
