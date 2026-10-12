import {writeFileSync,statSync} from 'node:fs';
writeFileSync('dist/_routes.json',JSON.stringify({version:1,include:['/api/*','/staff','/staff/*'],exclude:[]}));
writeFileSync('dist/_headers',`/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'\n`);
const size=statSync('dist/_worker.js').size;
if(size>2_500_000)throw new Error('Worker bundle exceeds the free deployment budget.');
console.log(`Cloudflare bundle ready (${size} bytes).`);
