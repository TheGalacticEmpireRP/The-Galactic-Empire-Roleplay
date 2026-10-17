import ts from 'typescript';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
for(const file of ['lib/public-info.ts','lib/gmail.ts','lib/email.ts','lib/content.ts','lib/validation.ts','lib/receipts.ts','lib/service.ts','app/support-center.tsx','app/staff-login.tsx','worker/staff-auth.ts','worker/evidence.ts','worker/index.ts']){
  const output='.checks/'+file.replace(/\.tsx?$/,'.js');
  mkdirSync(output.slice(0,output.lastIndexOf('/')),{recursive:true});
  const compiled=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/from "(\.\.?\/[^".]+)"/g,'from "$1.js"');
  writeFileSync(output,compiled);
}
await import('./service.test.mjs');
await import('./cloudflare.test.mjs');
await import('./deployment.test.mjs');

await import('./staff-auth.test.mjs');


await import("./email.test.mjs");

await import("./gmail.test.mjs");

await import("./public-info.test.mjs");
