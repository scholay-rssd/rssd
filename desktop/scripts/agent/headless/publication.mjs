// A saved manuscript or an accepted request is not a verified publication.
export async function confirmPublication(client,id,{attempts=13,delayMs=10000,sleep=ms=>new Promise(r=>setTimeout(r,ms)),onReceipt=()=>{}}={}){
 for(let i=0;i<attempts;i++){
  const receipt=(await client.status(id)).receipt;
  onReceipt(receipt);
  if(receipt?.publicReadback&&receipt.job?.status==='success')return receipt;
  if(['failed','cancelled'].includes(receipt?.job?.status)||['rejected','not_submitted'].includes(receipt?.status))throw Error('publication failed; original request retained: '+(receipt?.requestKey||id));
  if(i+1<attempts)await sleep(delayMs);
 }
 throw Error('publication not confirmed; resume to query the original request: '+id);
}
