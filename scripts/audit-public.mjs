import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
const base=process.env.AUDIT_BASE_URL||'https://cinevjet-hoanganh-dz.vercel.app';
const output=process.env.AUDIT_OUTPUT||'.vercel/audit-before.json';
const expectFixed=process.env.AUDIT_EXPECT_FIXED==='1';
await mkdir('test-results/audit',{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const result={base,lab:[],errors:[],brokenAssets:[],checks:[]};
try{
 for(let sample=0;sample<Number(process.env.AUDIT_LAB_SAMPLES||3);sample++){
  const c=await browser.newContext({viewport:{width:390,height:844}});
  await c.route('**/api/**',route=>['GET','HEAD'].includes(route.request().method())?route.continue():route.abort());
  const p=await c.newPage(),cdp=await c.newCDPSession(p);
  await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:100,downloadThroughput:200000,uploadThroughput:100000});
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  await p.addInitScript(()=>{window.auditVitals={lcp:0,cls:0,element:'',loadTime:0,longTasks:[]};new PerformanceObserver(l=>{for(const e of l.getEntries()){window.auditVitals.lcp=e.startTime;window.auditVitals.loadTime=e.loadTime;window.auditVitals.element=e.element?.className||e.element?.tagName}}).observe({type:'largest-contentful-paint',buffered:true});new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.auditVitals.cls+=e.value}).observe({type:'layout-shift',buffered:true});new PerformanceObserver(l=>{window.auditVitals.longTasks.push(...l.getEntries().map(e=>({start:Math.round(e.startTime),duration:Math.round(e.duration)})))}).observe({type:'longtask',buffered:true});});
  p.on('pageerror',e=>result.errors.push(e.message));
  p.on('response',r=>{if(r.status()>=400&&r.request().resourceType()==='image')result.brokenAssets.push(new URL(r.url()).pathname)});
  await p.goto(base+'/explore',{waitUntil:'domcontentloaded'});
  await p.locator('.hero-image:visible').first().evaluate(e=>e.complete?null:new Promise(resolve=>{e.onload=resolve;e.onerror=resolve}));
  await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(2000);
  const lab=await p.evaluate(()=>({lcp:Math.round(window.auditVitals.lcp),lcpElement:window.auditVitals.element,cls:Number(window.auditVitals.cls.toFixed(4)),ttfb:Math.round(performance.getEntriesByType('navigation')[0].responseStart),resources:performance.getEntriesByType('resource').length,bytes:performance.getEntriesByType('resource').reduce((s,r)=>s+r.transferSize,0),apiReads:performance.getEntriesByType('resource').filter(r=>new URL(r.name).pathname.startsWith('/api/')).map(r=>new URL(r.name).pathname),rsc:performance.getEntriesByType('resource').filter(r=>r.name.includes('_rsc=')).length,slowest:performance.getEntriesByType('resource').sort((a,b)=>b.duration-a.duration).slice(0,6).map(r=>({path:new URL(r.name).pathname,start:Math.round(r.startTime),duration:Math.round(r.duration),bytes:r.transferSize})),hero:document.querySelector('.hero-image')?.currentSrc}));
  lab.details=await p.evaluate(()=>({loadTime:window.auditVitals.loadTime,longTasks:window.auditVitals.longTasks.sort((a,b)=>b.duration-a.duration).slice(0,6),domContentLoaded:performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd}));
  result.lab.push(lab);console.log('LAB',sample+1,JSON.stringify(lab));await c.close();
 }
 await writeFile(output,JSON.stringify(result,null,2));
 const c=await browser.newContext();await c.route('**/api/**',route=>['GET','HEAD'].includes(route.request().method())?route.continue():route.abort());
 const p=await c.newPage();p.on('pageerror',e=>result.errors.push(e.message));
 const catalog=await(await c.request.get(base+'/api/catalog')).json();assert.ok(catalog.items.length);
 for(const width of [320,375,390,430,768,1440]){
  await p.setViewportSize({width,height:900});const r=await p.goto(base+'/explore');assert.equal(r.status(),200);await p.locator('img.brand-logo:visible').first().waitFor();
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.equal(await p.locator('img.brand-logo:visible').count(),1);
 }
 result.checks.push('public responsive 320/375/390/430/768/1440');
 const movie=catalog.items.find(m=>!m.vip_required);assert.ok(movie);
 await p.goto(base+'/movie/'+movie.slug);await p.getByRole('heading',{name:movie.title,exact:true}).first().waitFor();
 result.movieMetadata={title:await p.title(),canonical:await p.locator('link[rel=canonical]').getAttribute('href').catch(()=>null)};
 if(expectFixed){assert.equal(result.movieMetadata.title,movie.title+' | CineVjet');assert.equal(result.movieMetadata.canonical,'https://cinevjet-hoanganh-dz.vercel.app/movie/'+movie.slug);}
 const watch=p.locator('a[href^="/watch/"]').first();await watch.click();
 await p.locator('video').first().waitFor();await p.getByRole('button',{name:'Phát video',exact:true}).click();
 await p.waitForFunction(()=>{const v=document.querySelector('video');return v&&v.currentTime>.3&&!v.paused},{},{timeout:25000});
 result.playback=await p.locator('video').evaluate(v=>({duration:Math.round(v.duration),position:v.currentTime,readyState:v.readyState}));await p.locator('video').evaluate(v=>v.pause());result.checks.push('licensed MP4 actual playback');
 await p.getByRole('button',{name:'Báo lỗi',exact:true}).click();
 const modal=await p.getByRole('dialog').boundingBox();assert.ok(modal&&modal.height<900);await p.keyboard.press('Escape');
 for(const path of ['/api/account','/api/admin/withdrawals','/api/rewards/redemptions','/api/payments/payos','/api/shorts','/api/internal/shorts-sync','/robots.txt','/sitemap.xml','/login']){
  const r=await c.request.get(base+path,{maxRedirects:0});result.checks.push({path,status:r.status(),noindex:r.headers()['x-robots-tag']||null});
  if(expectFixed){
   const protectedApi=['/api/admin/withdrawals','/api/rewards/redemptions','/api/payments/payos','/api/internal/shorts-sync'].includes(path);
   assert.equal(r.status(),protectedApi?401:200,path);
   if(path.startsWith('/api/')||path==='/login')assert.match(r.headers()['x-robots-tag']||'',/noindex/);
   if(path==='/sitemap.xml'){const xml=await r.text();assert.ok(xml.includes('/movie/'+movie.slug));assert.ok(!/\/(admin|profile|wallet|payments|rewards|watch|api)\//.test(xml));}
  }
 }
 assert.deepEqual(result.errors,[]);assert.deepEqual(result.brokenAssets,[]);
 await writeFile(output,JSON.stringify(result,null,2));console.log('AUDIT PUBLIC PASS',JSON.stringify({checks:result.checks,playback:result.playback,movieMetadata:result.movieMetadata}));
}finally{await browser.close();}
