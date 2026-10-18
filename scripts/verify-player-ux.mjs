import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const base='http://localhost:3017',f=JSON.parse(await readFile('.vercel/audit-qa.json','utf8'));
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const errors=[],progressWrites=[];
try{
 const c=await browser.newContext({viewport:{width:390,height:844}});
 await c.route(base+'/api/**',async r=>{
  if(r.request().method()==='PUT'&&new URL(r.request().url()).pathname==='/api/progress')progressWrites.push(r.request().postDataJSON());
  if(['GET','HEAD'].includes(r.request().method()))return r.continue();const response=await r.fetch({headers:{...r.request().headers(),origin:'https://cinevjet-hoanganh-dz.vercel.app'}});await r.fulfill({response});
 });
 const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{window.loads=0;document.addEventListener('loadstart',e=>{if(e.target instanceof HTMLVideoElement&&e.target.src)window.loads++;},true);});
 await p.goto(base+'/login');await p.getByLabel('Email',{exact:true}).fill(f.memberEmail);await p.getByLabel('Mật khẩu',{exact:true}).fill(f.password);await p.getByRole('button',{name:'Đăng nhập',exact:true}).click();await p.waitForURL('**/profile');
 const before=(await (await c.request.get(base+'/api/account')).json()).balance;
 await p.goto(base+'/watch/spring');const v=p.locator('video:visible').first();await v.waitFor();await v.evaluate(v=>v.dataset.identity='original');
 await p.getByRole('button',{name:'Phát video',exact:true}).click();await p.waitForFunction(()=>Array.from(document.querySelectorAll('video')).some(v=>v.getClientRects().length&&v.currentTime>3));
 const loads=await p.evaluate(()=>window.loads);
 await p.getByRole('button',{name:'Tạm dừng',exact:true}).click();const position=await v.evaluate(v=>v.currentTime);await p.locator('.video-controls').getByRole('button',{name:'Phát',exact:true}).click();
 await p.getByRole('button',{name:'Báo lỗi',exact:true}).click();await p.getByRole('dialog').getByRole('button',{name:'Đóng',exact:true}).click();
 await p.waitForFunction(()=>Array.from(document.querySelectorAll('video')).some(v=>v.getClientRects().length&&v.currentTime>18),{},{timeout:30000});
 assert.equal(await v.getAttribute('data-identity'),'original');assert.equal(await p.evaluate(()=>window.loads),loads);assert.ok(await v.evaluate((v,t)=>v.currentTime>t,position));assert.ok(progressWrites.length>=2&&progressWrites.length<=5);
 const seek=async value=>p.getByRole('slider',{name:'Thời gian video',exact:true}).evaluate((el,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,String(value));el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},value);
 await seek(40);await p.waitForFunction(()=>{const v=Array.from(document.querySelectorAll('video')).find(v=>v.getClientRects().length);return v.currentTime>=39&&v.readyState>=3;});
 await p.getByRole('button',{name:'Toàn màn hình',exact:true}).click();await p.waitForFunction(()=>!!document.fullscreenElement);await p.getByRole('button',{name:'Thoát toàn màn hình',exact:true}).click();await p.waitForFunction(()=>!document.fullscreenElement);
 await p.getByRole('button',{name:'Tạm dừng',exact:true}).click();const pausedAt=await v.evaluate(v=>v.currentTime);
 await p.getByLabel('Chất lượng video',{exact:true}).selectOption('licensed-spring-480p');
 await p.waitForFunction(t=>{const v=Array.from(document.querySelectorAll('video')).find(v=>v.getClientRects().length);return v.readyState>=3&&Math.abs(v.currentTime-t)<1;},pausedAt);
 assert.equal(await v.evaluate(v=>v.paused),true);assert.equal(await v.getAttribute('data-identity'),'original');
 await p.locator('.video-controls').getByRole('button',{name:'Phát',exact:true}).click();
 await v.evaluate(v=>{v.dispatchEvent(new Event('waiting'));setTimeout(()=>v.dispatchEvent(new Event('playing')),100);});await p.waitForTimeout(500);assert.equal(await p.locator('.video-loading:visible').count(),0);
 await c.setOffline(true);await seek(330);await p.locator('.video-error:visible').waitFor({timeout:20000});assert.equal(new URL(p.url()).pathname,'/watch/spring');const offlineAt=await v.evaluate(v=>v.currentTime);assert.ok(offlineAt>320);
 await c.setOffline(false);if(await p.locator('.video-error:visible').count())await p.getByRole('button',{name:'Thử lại',exact:true}).click();
 await p.waitForFunction(()=>{const v=Array.from(document.querySelectorAll('video')).find(v=>v.getClientRects().length);return v.currentTime>329&&v.readyState>=3;},{},{timeout:25000});assert.equal(await v.getAttribute('data-identity'),'original');
 assert.deepEqual((await (await c.request.get(base+'/api/account')).json()).balance,before);
 for(const width of [320,375,390,430,768,1440]){await p.setViewportSize({width,height:844});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.equal(await p.locator('video:visible').count(),1);}
 await c.close();
 const bad=await browser.newContext();await bad.route('https://video.blender.org/object-storage/web_videos/**',r=>r.fulfill({status:404,contentType:'video/mp4',body:''}));const b=await bad.newPage();await b.goto(base+'/watch/charge');await b.locator('.video-error:visible').waitFor({timeout:20000});assert.equal(await b.locator('.video-loading:visible').count(),0);await bad.close();
 assert.deepEqual(errors,[]);await writeFile('.vercel/player-ux-results.json',JSON.stringify({passed:true,progressWrites:progressWrites.length,baselineSourceLoads:loads,offlinePosition:offlineAt}));console.log('PLAYER UX PASS: one stable video through progress/pause/UI/fullscreen, quality preserves position and pause, no spinner flash, bounded offline/error recovery, no episode change, 320–1440px, balances unchanged.');
}finally{await browser.close();}
