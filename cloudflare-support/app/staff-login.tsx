import {useState} from "react";
import {Eye,EyeOff,LockKeyhole,LogIn,ShieldCheck} from "lucide-react";

export default function StaffLogin({ready=true,onSignIn}:{ready?:boolean;onSignIn:(email:string,code:string)=>Promise<void>}){
  const [email,setEmail]=useState(""),[code,setCode]=useState(""),[visible,setVisible]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  return <section className="panel staff-login">
    <div className="login-mark"><ShieldCheck size={25}/></div>
    <div className="eyebrow">AUTHORIZED PERSONNEL</div>
    <h2>Welcome back, officer.</h2>
    <p>Sign in with your staff email and the private access code provided by the support owner.</p>
    {!ready?<div className="notice"><LockKeyhole size={18}/><span>The owner is preparing staff sign-in. Members can still open and track support tickets.</span></div>:<form className="form" onSubmit={async event=>{
      event.preventDefault();setBusy(true);setError("");
      try{await onSignIn(email.trim(),code.trim());setCode("");}
      catch(error){setError(error instanceof Error?error.message:"Unable to sign in. Try again.");}
      finally{setBusy(false);}
    }}>
      {error&&<div className="error-banner" role="alert">{error}</div>}
      <label className="field"><span>Staff email <span className="required">*</span></span><input type="email" required autoComplete="username" maxLength={254} value={email} onChange={event=>setEmail(event.target.value)} placeholder="officer@example.com" disabled={busy}/></label>
      <label className="field"><span>Private access code <span className="required">*</span></span><div className="login-code-field"><input type={visible?"text":"password"} required minLength={64} maxLength={64} pattern="[a-fA-F0-9]{64}" autoComplete="current-password" spellCheck={false} autoCapitalize="none" value={code} onChange={event=>setCode(event.target.value.trim())} placeholder="Paste your private staff code" disabled={busy}/><button type="button" className="iconbtn" aria-label={visible?"Hide access code":"Show access code"} onClick={()=>setVisible(!visible)}>{visible?<EyeOff size={17}/>:<Eye size={17}/>}</button></div><small>Your code has 64 characters. Keep it private, like a password.</small></label>
      <button className="btn primary" disabled={busy}><LogIn size={16}/>{busy?"Signing in…":"Sign in to staff console"}</button>
      <p className="smallnote">Sessions last up to eight hours. Lost your code? Ask the owner to create a new one.</p>
    </form>}
    <a className="text-link" href="/">Return to member support</a>
  </section>;
}
