export function cloudflareClient(env=process.env,request=fetch){
  const token=env.CLOUDFLARE_API_TOKEN,account=env.CLOUDFLARE_ACCOUNT_ID;
  if(!token||!account)throw new Error('Add CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID to GitHub Actions secrets before deploying.');
  if(!/^[a-f0-9]{32}$/i.test(account))throw new Error('CLOUDFLARE_ACCOUNT_ID must be the 32-character account ID.');
  return async function api(path,method='GET',body,allow404=false){
    const response=await request(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`,{
      method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000),redirect:'error'
    });
    if(allow404&&response.status===404)return null;
    let data;try{data=await response.json();}catch{throw new Error(`Cloudflare ${method} request failed (HTTP ${response.status}).`);}
    if(!response.ok||data.success===false){
      // API responses may include private database values. Never print a response or token.
      const codes=(data.errors||[]).map(e=>e.code).filter(Number.isInteger).join(',');
      throw new Error(`Cloudflare ${method} request failed (HTTP ${response.status}${codes?`, code ${codes}`:''}). Check the token permissions and project name.`);
    }
    return data.result;
  };
}
export function projectName(value='tge-support'){
  if(!/^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/.test(value))throw new Error('Use a project name of 1–58 lowercase letters, numbers and hyphens.');
  return value;
}
