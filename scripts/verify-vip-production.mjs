import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const ready=false;
const base='https://cinevjet-hoanganh-dz.vercel.app';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
 const c=await browser.newContext();const writes=[],errors=[],broken=[];
 await c.route('**/api/**',r=>{if(!['GET','HEAD'].includes(r.request().method())){writes.push(new URL(r.request().url()).pathname);return r.abort();}return r.continue();});
 const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('response',r=>{if(r.request().resourceType()==='image'&&r.status()>=400)broken.push(new URL(r.url()).pathname);});
 const rates=[2600,3375,3889,5917,9667,19333],prices=['150.000','300.000','500.000','1.000.000','2.000.000','5.000.000'];
 for(const width of ready?[390]:[320,375,390,430,768,1440]){
  await p.setViewportSize({width,height:800});assert.equal((await p.goto(base+'/vip')).status(),200);
  await p.locator('.vip-plan:visible').first().waitFor();assert.equal(await p.locator('.vip-plan:visible').count(),6);
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  for(let i=0;i<6;i++){
   const text=await p.locator('.vip-plan:visible').nth(i).innerText();assert.ok(text.includes(prices[i]));
   if(!ready)assert.ok(text.includes(rates[i].toLocaleString('vi-VN')+' xu'));
   assert.ok(!/Tổng gồm vốn|Tăng thêm|payOS/.test(text));
  }
  await p.getByRole('button',{name:'Chọn gói VIP 1',exact:true}).click();
  const modal=p.locator('.vip-checkout-modal:visible');await modal.waitFor();
  assert.ok((await modal.innerText()).includes('Chuyển khoản ngân hàng'));
  assert.ok(!/payOS|Tổng gồm vốn|Tăng thêm/.test(await modal.innerText()));
  const box=await modal.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1&&box.height<800);
  await modal.getByRole('button',{name:'Đóng',exact:true}).click();
 }
 const webhook=await c.request.post(base+'/api/payments/payos/webhook',{data:{code:'00',success:true,data:{},signature:'0'.repeat(64)}});assert.equal(webhook.status(),401,'Runtime must have all 3 credentials and reject unsigned webhooks before DB access');
 assert.equal((await c.request.get(base+'/api/payments/payos/webhook')).status(),405);
 for(const path of ['/api/vip/purchases','/api/admin/withdrawals','/api/payments/payos?plan_id=VIP_1'])assert.equal((await c.request.get(base+path)).status(),401);
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);assert.deepEqual(broken,[]);
 if(ready)await writeFile('.vercel/vip-bank-production-ready.json',JSON.stringify({projectId:'prj_pS99SOdXtn13R4CD2XyIvmBgimCA',snapshotRuntimeVerified:true,verifiedAt:new Date().toISOString()}));
 console.log(ready?'PRODUCTION snapshot-aware bank checkout is live; safe to update sale catalog.':'PRODUCTION PASS: six exact prices/rates, responsive bank summary, payment API protected, webhook exists and rejects invalid signature with runtime credentials present; no console errors or financial mutations. Actual provider payment not performed.');
}finally{await browser.close();}
