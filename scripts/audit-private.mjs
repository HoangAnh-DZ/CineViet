import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const base = "http://localhost:3017";
const fixture = JSON.parse(await readFile(".vercel/audit-qa.json", "utf8"));
const browser = await chromium.launch({headless:true,executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe"});
const errors=[];
async function login(role) {
  const context=await browser.newContext({viewport:{width:1440,height:900},permissions:["clipboard-read","clipboard-write"]});
  // The tested production build embeds its public origin. Only local QA traffic is adjusted.
  await context.route(base+"/api/**",async route=>{
    if(["GET","HEAD"].includes(route.request().method()))return route.continue();
    const response=await route.fetch({headers:{...route.request().headers(),origin:"https://cinevjet-hoanganh-dz.vercel.app"}});
    await route.fulfill({response});
  });
  const page=await context.newPage();
  page.on("response",async r=>{if(r.url()===base+"/api/auth/login"){const body=await r.json();console.log("QA login",r.status(),body.error||"success");}});
  page.on("pageerror",e=>errors.push(e.message));
  await page.goto(base+"/login");
  await page.getByLabel("Email",{exact:true}).fill(fixture[role+"Email"]);
  await page.getByLabel("Mật khẩu",{exact:true}).fill(fixture.password);
  await page.getByRole("button",{name:"Đăng nhập",exact:true}).click();
  await page.waitForURL("**/profile");
  return {context,page};
}
try {
  const {context,page}=await login("member");
  const response=await context.request.get(base+"/api/rewards/redemptions");
  assert.equal(response.status(),200);
  const redemption=await response.json();
  assert.equal(redemption.snapshot.available,30000);
  assert.equal(redemption.snapshot.reserved,70000);
  assert.equal(redemption.requests.length,2);
  assert.equal((await context.request.get(base+"/api/admin/withdrawals")).status(),403);
  if(process.env.AUDIT_PHASE!=="interactive") for(const path of ["/profile","/rewards","/rewards/redeem","/referrals","/list","/vip"]){
    for(const width of [320,390,768,1440]){
      await page.setViewportSize({width,height:900});
      const r=await page.goto(base+path);assert.equal(r.status(),200);
      assert.equal(new URL(page.url()).pathname,path,'QA navigation/session '+path);
      await page.locator("main h1:visible").first().waitFor();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),path+" overflow "+width);
      if(path.startsWith("/rewards")) {
        await page.getByText("30.000",{exact:false}).first().waitFor({timeout:10000}).catch(async e=>{console.log("QA PAGE",path,width,(await page.locator("main").innerText()).slice(-1400));throw e;});
        await page.getByText("Đang chờ đổi: 70.000 xu",{exact:false}).first().waitFor();
      }
    }
  }
  await page.goto(base+"/search");
  await page.route("**/api/catalog?*",r=>r.fulfill({status:503,contentType:"text/html",body:"<html>Gateway failure</html>"}));
  await page.getByLabel("Tìm phim, diễn viên",{exact:true}).fill("Spring",{timeout:10000}).catch(async e=>{console.log("QA EXPLORE",page.url(),(await page.locator("main").innerText()).slice(-1200));throw e;});
  await page.getByText("Dịch vụ tạm thời gián đoạn. Vui lòng tải lại sau.",{exact:true}).waitFor();
  await page.unroute("**/api/catalog?*");
  await page.getByRole("button",{name:"Thử lại",exact:true}).click();
  await page.locator('a.movie-card[href="/movie/spring"]').first().waitFor();
  assert.equal((await context.request.put(base+"/api/favorites",{headers:{origin:"https://cinevjet-hoanganh-dz.vercel.app"},data:{movie_id:"spring",active:false}})).status(),200);
  await page.goto(base+"/movie/spring");
  await page.getByRole("button",{name:"Thêm yêu thích",exact:true}).first().click();
  await page.getByRole("button",{name:"Bỏ yêu thích",exact:true}).first().waitFor();
  await page.goto(base+"/list");await page.getByRole("tab",{name:/^Đã lưu/}).click();await page.getByText("Spring",{exact:true}).first().waitFor();
  const catalog=await(await context.request.get(base+"/api/catalog")).json();
  const movie=catalog.items.find(m=>!m.vip_required);
  await page.goto(base+"/watch/"+movie.id);
  await page.getByRole("button",{name:"Báo lỗi",exact:true}).click();
  await page.getByRole("button",{name:"Sao chép thông tin lỗi",exact:true}).click();
  await page.getByRole("status").filter({hasText:"Đã sao chép thông tin lỗi"}).waitFor();
  const diagnostic=await page.evaluate(()=>navigator.clipboard.readText());
  assert.ok(diagnostic.includes(movie.id));assert.ok(!/token=|example.invalid|object-storage/.test(diagnostic));
  await context.close();
  const admin=await login("admin");
  const queue=await(await admin.context.request.get(base+"/api/admin/withdrawals")).json();
  assert.equal(queue.total,2);assert.deepEqual(queue.items.map(r=>r.id).sort(),fixture.orders.sort());
  await admin.page.goto(base+"/admin/finance?view=withdrawals");
  await admin.page.getByRole("heading",{name:"Lệnh rút tiền / đổi thưởng",exact:true}).waitFor();
  assert.equal(await admin.page.locator("tbody tr").count(),2);
  assert.equal(await admin.page.getByRole("heading",{name:"Biến động dòng tiền",exact:true}).count(),0);
  for(const path of ["/admin/finance?view=deposits","/admin/rewards","/admin/settings","/admin/plans","/admin/shorts"]){
    for(const width of [390,1440]){
      await admin.page.setViewportSize({width,height:900});
      assert.equal((await admin.page.goto(base+path)).status(),200);
      await admin.page.locator("main h1:visible").first().waitFor();
      assert.ok(await admin.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),path+" overflow "+width);
    }
  }
  assert.deepEqual(errors,[]);
  console.log("PRIVATE BROWSER PASS: actual login, 30k available/70k held, two Admin orders, authorization, responsive private/Admin pages, failed search and retry, favorites, sanitized diagnostic copy. In-memory QA only.");
} finally {await browser.close();}
