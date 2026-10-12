export type SavedReceipt={reference:string;key:string;category:string;title:string;savedAt:number};
type StorageLike={getItem(key:string):string|null;setItem(key:string,value:string):void};
export const RECEIPTS_KEY="tge-saved-receipts-v1";
export function readReceipts(storage:StorageLike):SavedReceipt[]{
  try{
    const data=JSON.parse(storage.getItem(RECEIPTS_KEY)||"[]");
    if(!Array.isArray(data))return [];
    return data.slice(0,50).filter(r=>r&&/^TGE-\d{4}-[A-F0-9]{8}$/.test(r.reference)&&/^[a-f0-9]{64}$/.test(r.key)&&["careers","reports","general","appeals"].includes(r.category)&&typeof r.title==="string"&&r.title.length<=120&&Number.isFinite(r.savedAt)).map(({reference,key,category,title,savedAt})=>({reference,key,category,title,savedAt}));
  }catch{return [];}
}
export function saveReceipt(storage:StorageLike,receipt:SavedReceipt){
  // Reuse validation before persisting; ticket keys are saved only after an explicit click.
  const checked=readReceipts({getItem:()=>JSON.stringify([receipt]),setItem:()=>{}});
  if(!checked.length)throw new Error("Open a ticket with its private key before saving it on this device.");
  const items=[receipt,...readReceipts(storage).filter(r=>r.reference!==receipt.reference)].slice(0,50);
  storage.setItem(RECEIPTS_KEY,JSON.stringify(items));return items;
}
export function forgetReceipt(storage:StorageLike,reference:string){
  const items=readReceipts(storage).filter(r=>r.reference!==reference);
  storage.setItem(RECEIPTS_KEY,JSON.stringify(items));return items;
}
