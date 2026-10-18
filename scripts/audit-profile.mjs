import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe"});
try {
 const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.route("**/api/**",r=>["GET","HEAD"].includes(r.request().method())?r.continue():r.abort());
 const page=await context.newPage(),cdp=await context.newCDPSession(page);
 await cdp.send("Network.enable");await cdp.send("Network.setCacheDisabled",{cacheDisabled:true});
 await cdp.send("Network.emulateNetworkConditions",{offline:false,latency:100,downloadThroughput:200000,uploadThroughput:100000});
 await cdp.send("Emulation.setCPUThrottlingRate",{rate:4});
 await cdp.send("Profiler.enable");await cdp.send("Profiler.start");
 await page.goto("https://cinevjet-hoanganh-dz.vercel.app/explore",{waitUntil:"domcontentloaded"});
 await page.locator(".hero-image:visible").evaluate(e=>e.complete?null:new Promise(resolve=>e.onload=resolve));
 await page.waitForTimeout(2000);
 const {profile}=await cdp.send("Profiler.stop");
 await writeFile(".vercel/audit-cpu.json",JSON.stringify(profile));
 const nodes=new Map(profile.nodes.map(n=>[n.id,n])),cost=new Map();
 profile.samples.forEach((id,i)=>cost.set(id,(cost.get(id)||0)+(profile.timeDeltas[i]||0)/1000));
 console.log(JSON.stringify([...cost].sort((a,b)=>b[1]-a[1]).slice(0,24).map(([id,ms])=>({ms:Math.round(ms),frame:nodes.get(id).callFrame})),null,2));
}finally{await browser.close();}
