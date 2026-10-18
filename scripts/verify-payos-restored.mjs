import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const base='http://localhost:3017', f=JSON.parse(await readFile('.vercel/audit-qa.json','utf8'));
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const errors=[], creates=[];
async function signIn(role){
 const c=await browser.newContext({viewport:{width:390,height:844},permissions:['clipboard-read','clipboard-write']});
 await c.route(base+'/api/**',async r=>{
  if(r.request().method()==='POST'&&new URL(r.request().url()).pathname==='/api/payments/payos')creates.push(r.request().postDataJSON());
  if(['GET','HEAD'].includes(r.request().method()))return r.continue();
  const response=await r.fetch({headers:{...r.request().headers(),origin:'https://cinevjet-hoanganh-dz.vercel.app'}});await r.fulfill({response});
 });
 const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));
 await p.goto(base+'/login');await p.getByLabel('Email',{exact:true}).fill(f[role+'Email']);await p.getByLabel('Mật khẩu',{exact:true}).fill(f.password);await p.getByRole('button',{name:'Đăng nhập',exact:true}).click();await p.waitForURL('**/profile');return {c,p};
}
try{
 await mkdir('test-results/payos-restored',{recursive:true});
 const {c,p}=await signIn('member');
 const before=await (await c.request.get(base+'/api/account')).json();
 await p.goto(base+'/vip');
 await p.locator('.vip-plan:visible').first().waitFor();
 const rates=[2600,3375,3889,5917,9667,19333];
 assert.equal(await p.locator('.vip-plan:visible').count(),6);
 for(let i=0;i<6;i++)assert.ok((await p.locator('.vip-plan:visible').nth(i).innerText()).includes(rates[i].toLocaleString('vi-VN')+' xu'));
 for(const width of [320,375,390,430,768,1440]){
  await p.setViewportSize({width,height:740});await p.getByRole('button',{name:'Chọn gói VIP 6',exact:true}).click();
  const d=p.getByRole('dialog');await d.getByRole('button',{name:'Xác nhận & thanh toán',exact:true}).waitFor();
  await d.getByRole('button',{name:'Xác nhận & thanh toán',exact:true}).isEnabled();
  assert.ok(!/payOS|Admin|Tổng gồm vốn|Tăng thêm/.test(await d.innerText()));
  const box=await d.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1&&box.height<=740-20);
  await d.getByRole('button',{name:'Đóng',exact:true}).click();
 }
 await p.setViewportSize({width:320,height:640});await p.getByRole('button',{name:'Chọn gói VIP 1',exact:true}).click();let d=p.getByRole('dialog');
 await d.getByRole('button',{name:'Xác nhận & thanh toán',exact:true}).click();await d.getByRole('heading',{name:'Thông tin thanh toán',exact:true}).waitFor();
 const qr=d.getByRole('img',{name:'Mã QR chuyển khoản ngân hàng',exact:true});await qr.waitFor();assert.ok((await qr.getAttribute('src')).startsWith('data:image/png'));
 const {order}=await (await c.request.get(base+'/api/payments/payos?plan_id=VIP_1')).json();assert.equal(order.amount,150000);assert.equal(order.status,'PENDING');
 const reference='CVJ'+String(order.order_code).slice(-6);
 assert.ok((await d.innerText()).includes(reference));assert.ok(!/payOS|Admin/.test(await d.innerText()));
 for(const [label,value] of [['Sao chép số tài khoản','TESTONLY'],['Sao chép nội dung chuyển khoản',reference],['Sao chép số tiền','150000']]){
  await d.getByRole('button',{name:label,exact:true}).click();assert.equal(await p.evaluate(()=>navigator.clipboard.readText()),value);
 }
 for(const width of [320,390,768,1440]){
  await p.setViewportSize({width,height:740});const box=await d.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1&&box.height<=740-20);
  assert.ok(await d.evaluate(e=>e.scrollWidth<=e.clientWidth+1));assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 }
 await p.setViewportSize({width:320,height:740});await d.evaluate(e=>e.scrollTop=0);await p.screenshot({path:'test-results/payos-restored/mobile.png'});
 await p.setViewportSize({width:1440,height:900});await p.screenshot({path:'test-results/payos-restored/desktop.png'});
 const duplicate=await c.request.post(base+'/api/payments/payos',{headers:{origin:'https://cinevjet-hoanganh-dz.vercel.app'},data:{kind:'VIP_PURCHASE',plan_id:'VIP_1',idempotency_key:randomUUID()}});assert.equal(duplicate.status(),201);assert.equal((await duplicate.json()).id,order.id);
 assert.deepEqual((await (await c.request.get(base+'/api/account')).json()).balance,before.balance);
 await p.goto(base+'/payments/payos/'+order.id+'?status=PAID&code=00');await p.getByText('Chờ thanh toán',{exact:true}).waitFor();assert.ok(!(await (await c.request.get(base+'/api/account')).json()).entitlements.includes('VIP_MOVIES'));
 await p.goto(base+'/vip');await p.getByRole('button',{name:'Chọn gói VIP 1',exact:true}).click();d=p.getByRole('dialog');await d.getByText(reference,{exact:true}).waitFor();assert.equal(creates.length,1);
 const admin=await signIn('admin');await admin.p.goto(base+'/admin/finance?view=deposits');
 const row=admin.p.locator('tbody tr').filter({hasText:'VIP 1'});await row.getByRole('button',{name:'Xem / Duyệt',exact:true}).click();const review=admin.p.getByRole('dialog');await review.getByText(/payOS · Mã đơn:/).waitFor();assert.equal(await review.locator('.money-review-form').count(),0);
 const settled=await (await fetch('http://127.0.0.1:3018/__qa/settle',{method:'POST',headers:{authorization:'Bearer '+f.control,'content-type':'application/json'},body:JSON.stringify({code:order.order_code})})).json();
 assert.equal(settled.invalid,401);assert.deepEqual(settled.valid,[200,200,200]);assert.equal(settled.creates,1);
 await d.getByRole('button',{name:'Kiểm tra trạng thái',exact:true}).click();await d.getByRole('heading',{name:'Thanh toán thành công',exact:true}).waitFor();
 const after=await (await c.request.get(base+'/api/account')).json();assert.deepEqual(after.balance,before.balance);assert.ok(after.entitlements.includes('VIP_MOVIES'));
 const missions=await (await c.request.get(base+'/api/rewards/missions')).json();assert.equal(missions.missions.length,5);assert.equal(missions.missions[0].reward,2600);
 const detail=await (await admin.c.request.get(base+'/api/admin/money/VIP_PURCHASE/'+order.id)).json();assert.equal(detail.status,'COMPLETED');assert.equal(detail.payos_status,'PAID');
 assert.deepEqual(errors,[]);console.log('LOCAL PAYOS FLOW PASS: browser → API → signed provider mock → exact QR/copy → unpaid protection → forged callback rejected → bad signature rejected → duplicate webhooks activate once → updated UI/Admin; 320–1440px, balances preserved.');
}finally{await browser.close();}
