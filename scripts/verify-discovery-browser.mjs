import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const base=process.env.DISCOVERY_BASE||'http://localhost:3017';
const bytes=await readFile('database/discovery-expansion.json'),catalog=JSON.parse(bytes);
const targets=catalog.flatMap(m=>m.episodes?.length?m.episodes.map(e=>({movie:m.id,episode:e.id,duration:e.duration_seconds,sources:e.sources})): [{movie:m.id,duration:m.duration_seconds,sources:m.sources}]);
const file=process.env.DISCOVERY_BROWSER_OUTPUT||'.vercel/discovery-browser-results.json';
let previous;try{previous=JSON.parse(await readFile(file,'utf8'));}catch{}
const result={base,manifestSha256:createHash('sha256').update(bytes).digest('hex'),items:previous?.base===base?previous.items.filter(x=>x.passed&&targets.some(t=>t.movie===x.movie&&t.episode===x.episode&&t.sources.some(s=>s.url===x.source))):[],errors:[]};
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
 const c=await browser.newContext({viewport:{width:390,height:844}});await c.route('**/api/**',r=>['GET','HEAD'].includes(r.request().method())?r.continue():r.abort());
 const p=await c.newPage();await p.addInitScript(()=>{window.mediaEvents=[];for(const event of ['loadstart','playing','waiting','pause','error','loadedmetadata'])document.addEventListener(event,e=>{if(e.target instanceof HTMLVideoElement)window.mediaEvents.push({event,position:e.target.currentTime,source:e.target.currentSrc,paused:e.target.paused,error:e.target.error?.code});},true);});p.on('pageerror',e=>result.errors.push(e.message));let limited=false;p.on('response',r=>{if(r.status()===429&&r.request().resourceType()==='media')limited=true;});
 for(const t of targets){
  if(result.items.some(x=>x.movie===t.movie&&x.episode===t.episode&&x.passed))continue;
  const path='/watch/'+t.movie+(t.episode?'/'+t.episode:'');const started=Date.now();let entry={movie:t.movie,episode:t.episode,passed:false};
  try{
   assert.equal((await p.goto(base+path,{waitUntil:'domcontentloaded'})).status(),200);const v=p.locator('video:visible').first();await v.waitFor({timeout:15000});
   await p.getByRole('button',{name:'Phát video',exact:true}).click({timeout:15000});
   await p.waitForFunction(()=>{const v=Array.from(document.querySelectorAll('video')).find(v=>v.getClientRects().length);return v&&v.currentTime>.25&&!v.paused;},{},{timeout:20000});
   const state=await v.evaluate(v=>({duration:v.duration,position:v.currentTime,source:v.currentSrc,error:v.error?.code||null}));
   assert.ok(Math.abs(state.duration-t.duration)<3);assert.ok(t.sources.some(s=>s.url===state.source));assert.equal(await p.locator('video:visible').count(),1);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await v.evaluate(v=>v.pause());entry={...entry,...state,passed:true,startupMs:Date.now()-started};
  }catch(e){entry.error=e.message.split('\n')[0];entry.media=await p.evaluate(()=>({events:window.mediaEvents,error:document.querySelector('.video-error')?.textContent,videos:Array.from(document.querySelectorAll('video')).map(v=>({src:v.currentSrc,paused:v.paused,currentTime:v.currentTime,ready:v.readyState,error:v.error?.code}))}));console.log('PLAYBACK FAIL',t.movie,t.episode||'',entry.error);}
  result.items.push(entry);await writeFile(file,JSON.stringify(result));
  if(limited)throw new Error('Provider rate limit: stopped without bypass/repeated requests');
  await new Promise(r=>setTimeout(r,1800));
 }
 assert.equal(result.items.filter(x=>x.passed).length,targets.length);assert.deepEqual(result.errors,[]);
 for(const width of [320,375,390,430,768,1440]){await p.setViewportSize({width,height:850});await p.goto(base+'/explore');await p.locator('.hero-image:visible').first().waitFor();assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
 await p.goto(base+'/movie/judex-1916');await p.getByRole('link',{name:'Xem tập đầu',exact:true}).click();await p.waitForURL('**/watch/judex-1916/judex-1916-ep-1');await p.getByRole('link',{name:'Tập sau',exact:true}).click();await p.waitForURL('**/watch/judex-1916/judex-1916-ep-2');
 await p.getByRole('link',{name:'Tập trước',exact:true}).click();await p.waitForURL('**/watch/judex-1916/judex-1916-ep-1');
 await mkdir('test-results/discovery',{recursive:true});await p.screenshot({path:'test-results/discovery/watch-desktop.png'});await p.setViewportSize({width:390,height:844});await p.goto(base+'/explore');await p.locator('.hero-image:visible').first().waitFor();await p.screenshot({path:'test-results/discovery/explore-mobile.png'});
 result.passed=true;await writeFile(file,JSON.stringify(result));console.log('DISCOVERY BROWSER PASS: '+targets.length+' actual full-source movie/episode starts decoded in Chrome, correct duration/ownership, one visible player, episode navigation, 320–1440px.');
}finally{await browser.close();}
