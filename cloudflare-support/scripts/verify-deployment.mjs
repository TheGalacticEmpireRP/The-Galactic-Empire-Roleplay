class NotReady extends Error {}
class UnsafeAccess extends Error {}

// A successful upload can precede the production hostname becoming ready.
// Retry public GETs only; never create a sample ticket or print response bodies.
export async function waitForSupport(url,{request=fetch,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),attempts=12,delay=5000,log=console.log}={}){
  const deadline=Date.now()+120000;
  let last='The public endpoints have not responded.';
  for(let attempt=1;attempt<=attempts&&Date.now()<deadline;attempt++){
    try{
      const get=path=>request(`${url}${path}`,{
        redirect:'manual',headers:{'Cache-Control':'no-cache'},
        signal:AbortSignal.timeout(Math.max(1,Math.min(10000,deadline-Date.now())))
      });
      const response=await get('/api/support/session');
      if(response.status!==200){await response.body?.cancel();throw new NotReady(`Public session returned HTTP ${response.status}.`);}
      const session=await response.json();
      if(session?.staff||session?.signedIn||session?.hasAccount)throw new UnsafeAccess('Anonymous access verification failed. Keep the existing support links.');
      if(session?.signedIn!==false||session?.staff!==null||session?.hasAccount!==false)throw new NotReady('Public session did not return the expected anonymous response.');
      const forbidden=await get('/api/support/staff/tickets');
      await forbidden.body?.cancel();
      if(forbidden.status===200)throw new UnsafeAccess('Staff access verification failed (HTTP 200). Keep the existing support links.');
      if(forbidden.status!==403||!forbidden.headers.get('content-type')?.includes('application/json'))throw new NotReady(`Staff protection check returned HTTP ${forbidden.status}.`);
      const page=await get('/');
      await page.body?.cancel();
      if(page.status!==200||!page.headers.get('content-type')?.includes('text/html'))throw new NotReady(`Support page returned HTTP ${page.status}.`);
      return;
    }catch(error){
      if(error instanceof UnsafeAccess)throw error;
      last=error instanceof NotReady?error.message:'Public endpoint could not be reached or did not return valid JSON.';
      const remaining=deadline-Date.now();
      if(attempt<attempts&&remaining>0){
        log(`Deployment readiness check ${attempt}/${attempts}: ${last} Retrying shortly.`);
        await pause(Math.min(delay,remaining));
      }
    }
  }
  throw new Error(`Deployment uploaded to ${url}, but public verification failed: ${last} Keep the existing support links.`);
}
