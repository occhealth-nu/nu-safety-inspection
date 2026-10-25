// สร้างภาพหน้าจอประกอบคู่มือ (docs/manual/img) จาก stack ทดสอบในเครื่องที่มีข้อมูลสาธิต
// ใช้: bash scripts/e2e-stack.sh && (build + next start :3000 ด้วย .env.e2e) แล้ว node tests/manual/capture.mjs [ชื่อกลุ่ม...]
// ภาพทั้งหมดเป็นข้อมูลสมมติ — ห้ามรันกับระบบจริง
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "docs/manual/img");
const ASSETS = path.join(ROOT, "tests/manual/assets");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PASS = process.env.DEMO_PASSWORD ?? "Demo-Only-Pass-2569";
const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 844 };
fs.mkdirSync(OUT, { recursive: true });

const state = {};   // ค่าที่ส่งต่อระหว่างขั้นตอน เช่น URL ของข้อบกพร่องที่สร้างขึ้น
const only = new Set(process.argv.slice(2));

async function open(browser, user, viewport = DESKTOP) {
  const mobile = viewport.width < 600;
  const ctx = await browser.newContext({ baseURL: BASE, viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, locale: "th-TH", timezoneId: "Asia/Bangkok" });
  const page = await ctx.newPage();
  if (user) {
    await page.goto("/login");
    await page.locator("summary").click();
    await page.getByLabel("อีเมล").fill(`${user}@demo.example.com`);
    await page.getByLabel("รหัสผ่าน").fill(PASS);
    await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  }
  return page;
}

async function go(page, url) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}

/** วาดกรอบสีแดงพร้อมหมายเลขรอบ element ที่ต้องการอธิบาย */
async function mark(page, items) {
  const boxes = [];
  for (const [n, loc, opt = {}] of items) {
    const l = loc.first();
    const ok = await l.waitFor({ state: "visible", timeout: 6000 }).then(() => true, () => false);
    const b = ok && (await l.boundingBox());
    if (!b) { console.warn(`  ! marker ${n} not found`); continue; }
    boxes.push({ n, x: b.x, y: b.y, w: b.width, h: b.height, pad: opt.pad ?? 4, corner: opt.corner ?? "tr" });
  }
  await page.evaluate((boxes) => {
    document.querySelectorAll(".__mk").forEach((e) => e.remove());
    for (const b of boxes) {
      const d = document.createElement("div");
      d.className = "__mk";
      Object.assign(d.style, {
        position: "absolute", left: `${b.x + scrollX - b.pad}px`, top: `${b.y + scrollY - b.pad}px`,
        width: `${b.w + b.pad * 2}px`, height: `${b.h + b.pad * 2}px`, border: "3px solid #E11D48",
        borderRadius: "10px", zIndex: 2147483646, pointerEvents: "none", boxSizing: "border-box",
      });
      const c = document.createElement("div");
      c.textContent = String(b.n);
      const pos = { tr: { right: "-13px", top: "-13px" }, tl: { left: "-13px", top: "-13px" }, br: { right: "-13px", bottom: "-13px" }, bl: { left: "-13px", bottom: "-13px" }, l: { left: "-30px", top: "calc(50% - 12px)" }, r: { right: "-30px", top: "calc(50% - 12px)" } }[b.corner];
      Object.assign(c.style, {
        position: "absolute", ...pos, width: "24px", height: "24px", borderRadius: "50%", background: "#E11D48",
        color: "#fff", font: "700 14px/24px sans-serif", textAlign: "center", boxShadow: "0 0 0 2px #fff",
      });
      d.appendChild(c);
      document.body.appendChild(d);
    }
  }, boxes);
}

async function shot(page, name, opt = {}) {
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: !!opt.fullPage, clip: opt.clip });
  await page.evaluate(() => document.querySelectorAll(".__mk").forEach((e) => e.remove()));
  console.log("•", name);
}

const main = (p) => p.locator("main");
/** เลื่อนให้ element อยู่ด้านบนของจอ (เว้นแถบหัว) */
async function focus(page, loc, offset = 90) {
  await loc.first().evaluate((e) => e.scrollIntoView({ block: "start" }));
  await page.evaluate((o) => window.scrollBy(0, -o), offset);
  await page.waitForTimeout(150);
}
const heading = (p, name) => main(p).getByRole("heading", { name });
async function pick(select, text) {
  const opts = await select.locator("option").evaluateAll((os) => os.map((o) => [o.value, o.textContent]));
  const hit = opts.find(([, t]) => (text instanceof RegExp ? text.test(t) : t.includes(text)));
  if (!hit) throw new Error(`no option ${text} in ${opts.map((o) => o[1]).join("|")}`);
  await select.selectOption(hit[0]);
}
const nav = (p, name) => p.getByRole("navigation", { name: "เมนูหลัก" }).getByRole("link", { name });

const groups = {
  // ---------- ส่วนที่ 1: เริ่มต้น ----------
  async login(b) {
    const p = await open(b, null);
    await go(p, "/login");
    const LOGIN_CLIP = { x: 330, y: 50, width: 620, height: 560 };
    await mark(p, [[1, p.getByRole("button", { name: /Google/ })], [2, p.locator("summary")]]);
    await shot(p, "01-login", { clip: LOGIN_CLIP });
    await p.locator("summary").click();
    await mark(p, [[1, p.getByLabel("อีเมล")], [2, p.getByLabel("รหัสผ่าน")], [3, p.getByRole("button", { name: "เข้าสู่ระบบ", exact: true })]]);
    await shot(p, "01-login-password", { clip: { ...LOGIN_CLIP, height: 700 } });
    await go(p, "/login?error=domain");
    await mark(p, [[1, p.getByRole("alert")]]);
    await shot(p, "01-login-error-domain", { clip: LOGIN_CLIP });
    await p.context().close();

    const m = await open(b, null, MOBILE);
    await go(m, "/login");
    await shot(m, "01-login-mobile");
    await m.context().close();
  },

  async norole(b) {
    // สร้างบัญชีที่ยังไม่มีบทบาท เพื่อแสดงหน้าที่ผู้ใช้ใหม่จะเห็น
    const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env.e2e"), "utf8").split("\n").filter(Boolean).map((l) => l.split(/=(.*)/s).slice(0, 2)));
    await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST", headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "newstaff@demo.example.com", password: PASS, email_confirm: true, user_metadata: { full_name: "บุคลากรใหม่ (ตัวอย่าง)" } }),
    });
    const p = await open(b, "newstaff");
    await go(p, "/");
    await mark(p, [[1, main(p).getByText(/ยังไม่ได้รับบทบาท/).first()]]);
    await shot(p, "02-no-role", { clip: { x: 0, y: 0, width: 1280, height: 360 } });
    await p.context().close();
  },

  async layout(b) {
    const p = await open(b, "admin");
    await go(p, "/");
    await mark(p, [
      [1, p.getByRole("navigation", { name: "เมนูหลัก" }), { corner: "tr" }],
      [2, p.getByRole("link", { name: /การแจ้งเตือน/ }), { corner: "bl" }],
      [3, p.getByRole("link", { name: /บัญชีของฉัน/ }), { corner: "tr" }],
      [4, p.getByRole("button", { name: /ออกจากระบบ/ }).or(p.getByRole("link", { name: /ออกจากระบบ/ })), { corner: "r" }],
    ]);
    await shot(p, "03-layout");
    await p.context().close();
    const n = await open(b, "eng.admin", { width: 1280, height: 640 });
    await go(n, "/notifications");
    await mark(n, [[1, main(n).locator("li, a").filter({ hasText: /ข้อบกพร่อง|งาน/ }).first(), { corner: "tr" }]]);
    await shot(n, "03-notifications");
    await n.context().close();

    const m = await open(b, "inspector.eng", MOBILE);
    await go(m, "/");
    await mark(m, [[1, m.getByRole("button", { name: "เปิดเมนู" })], [2, m.getByRole("link", { name: /การแจ้งเตือน/ }), { corner: "bl" }], [3, m.getByRole("navigation", { name: "เมนูลัด" }).getByRole("link", { name: "เริ่มตรวจ" }), { corner: "tr" }]]);
    await shot(m, "03-mobile-home");
    await m.getByRole("button", { name: "เปิดเมนู" }).click();
    await m.waitForTimeout(300);
    await shot(m, "03-mobile-menu");
    await m.context().close();
  },

  // ---------- ส่วนที่ 2: ผู้ตรวจ (มือถือ) ----------
  async inspector(b) {
    const m = await open(b, "inspector.eng", MOBILE);
    await go(m, "/inspect");
    await m.getByRole("button", { name: /เปิดกล้อง/ }).waitFor();
    await m.waitForTimeout(800);
    await mark(m, [
      [1, m.getByRole("button", { name: /เปิดกล้อง/ })],
      [2, m.getByPlaceholder(/รหัสจุดตรวจ/)],
      [3, m.getByText(/งานที่ต้องตรวจของฉัน/), { corner: "tl" }],
    ]);
    await shot(m, "10-inspect-home");
    // รายการงาน (เลื่อนลงไปที่รายการ)
    await focus(m, m.getByText(/งานที่ต้องตรวจของฉัน/).first(), 80);
    const firstTask = m.locator('a[href^="/inspect/start?asset="]').first();
    await mark(m, [[1, firstTask], [2, firstTask.getByText(/เกินกำหนด|รอตรวจ|ยังไม่ถึงกำหนด/).first(), { corner: "br" }]]);
    await shot(m, "10-inspect-tasklist");
    const task = m.locator('a[href^="/inspect/start?asset="]', { hasText: "FE-EN1" }).first();

    // หน้าจุดตรวจจาก QR
    const assetCode = (await task.innerText()).match(/FE-EN1-\d+/)[0];
    state.assetCode = assetCode;
    await go(m, `/q/lookup?code=${assetCode}`);
    await mark(m, [[1, m.locator("main h1").first(), { corner: "tr" }], [2, main(m).getByRole("link", { name: /เริ่มตรวจ/ }).or(main(m).getByRole("button", { name: /เริ่มตรวจ/ })).first()]]);
    await shot(m, "10-qr-asset");

    // เริ่มตรวจ
    await main(m).getByRole("link", { name: /เริ่มตรวจ/ }).or(main(m).getByRole("button", { name: /เริ่มตรวจ/ })).first().click();
    await m.waitForURL(/\/inspect\/[0-9a-f-]{36}$/);
    await m.waitForLoadState("networkidle");
    state.inspectUrl = new URL(m.url()).pathname;
    const items = m.locator("ol > li[id^=item-]");
    await items.nth(1).waitFor();
    const n = await items.count();
    const first = items.first();
    await mark(m, [[1, m.locator("main h1").first()], [2, first.getByRole("radio", { name: "ผ่าน", exact: true }), { corner: "tl" }], [3, first.getByRole("radio", { name: "ไม่ผ่าน", exact: true })], [4, first.getByRole("radio", { name: "ไม่เกี่ยวข้อง", exact: true }), { corner: "br" }]]);
    await shot(m, "11-form-top");

    // ส่งทั้งที่ยังไม่ครบ → ระบบแจ้งเตือน
    await m.getByRole("button", { name: "ส่งผลตรวจ" }).click();
    await m.getByText(/ยังกรอกข้อมูลไม่ครบ/).first().waitFor();
    await mark(m, [[1, m.getByText(/ยังกรอกข้อมูลไม่ครบ/).first()]]);
    await shot(m, "11-form-incomplete");

    // ข้อ 1 ไม่ผ่าน
    await first.scrollIntoViewIfNeeded();
    await first.getByRole("radio", { name: "ไม่ผ่าน", exact: true }).click();
    await first.getByPlaceholder("สิ่งที่พบ ตำแหน่ง และความเสี่ยง").fill("เข็มเกจวัดแรงดันตกอยู่ในแถบสีแดง (แรงดันต่ำ) ถังอาจใช้งานไม่ได้เมื่อเกิดเหตุ");
    await first.getByRole("button", { name: "สูง (เร่งด่วน)" }).click();
    await first.locator("input[type=file]").setInputFiles(path.join(ASSETS, "before.jpg"));
    await first.locator('img[alt="ภาพหลักฐาน"]').first().waitFor({ timeout: 20000 });
    await first.evaluate((e) => e.scrollIntoView({ block: "start" }));
    await m.evaluate(() => window.scrollBy(0, -70));
    await mark(m, [
      [1, first.getByRole("radio", { name: "ไม่ผ่าน", exact: true })],
      [2, first.getByPlaceholder("สิ่งที่พบ ตำแหน่ง และความเสี่ยง")],
      [3, first.getByRole("button", { name: "สูง (เร่งด่วน)" }), { corner: "tl" }],
      [4, first.locator('img[alt="ภาพหลักฐาน"]').first(), { corner: "tr" }],
    ]);
    await shot(m, "11-form-fail");

    // ข้ออื่นผ่าน ข้อสุดท้ายไม่เกี่ยวข้อง
    for (let i = 1; i < n; i++) {
      const it = items.nth(i);
      const na = it.getByRole("radio", { name: "ไม่เกี่ยวข้อง", exact: true });
      console.log("  item", i, "na", await na.count());
      if (i === n - 1 && (await na.count())) {
        await na.click();
        await it.getByPlaceholder("เช่น ถังชนิดนี้ไม่มีเกจวัด").fill("ถังชนิด CO2 ไม่มีเกจวัดแรงดัน");
        await it.evaluate((e) => e.scrollIntoView({ block: "start" }));
        await m.evaluate(() => window.scrollBy(0, -70));
        await mark(m, [[1, na], [2, it.getByPlaceholder("เช่น ถังชนิดนี้ไม่มีเกจวัด")]]);
        await shot(m, "11-form-na");
      } else {
        const ok = it.getByRole("radio", { name: "ผ่าน", exact: true });
        for (let t = 0; t < 3 && (await ok.getAttribute("aria-checked")) !== "true"; t++) { await ok.click(); await m.waitForTimeout(200); }
      }
    }
    const submit = m.getByRole("button", { name: "ส่งผลตรวจ" });
    await m.getByRole("button", { name: "ส่งผลตรวจ" }).locator("xpath=preceding-sibling::button").click();
    await m.getByText(/ร่างบันทึก/).first().waitFor({ timeout: 15000 });
    await mark(m, [[1, m.getByText(/^ตอบแล้ว/).first(), { corner: "tl" }], [2, m.getByText(/ร่างบันทึก/).first(), { corner: "tr" }], [3, submit.locator("xpath=preceding-sibling::button"), { corner: "tl" }], [4, submit]]);
    await shot(m, "11-form-bottom");

    await submit.click();
    await m.waitForURL(/\/inspections\/[0-9a-f-]{36}\?submitted=1/);
    await m.getByText("ระบบบันทึกผลตรวจเรียบร้อยแล้ว").waitFor();
    await mark(m, [[1, m.getByText("ระบบบันทึกผลตรวจเรียบร้อยแล้ว").first()], [2, m.locator('main a[href^="/findings/"]').first()]]);
    await shot(m, "12-submitted");
    state.findingUrl = await m.locator('main a[href^="/findings/"]').first().getAttribute("href");
    state.assetUrl = await m.locator('main a[href^="/assets/"]').first().getAttribute("href");
    fs.writeFileSync(path.join(OUT, "..", ".capture-state.json"), JSON.stringify(state));
    await m.context().close();
  },

  // ---------- ส่วนที่ 3: ติดตามแก้ไข ----------
  async assign(b) {
    const p = await open(b, "eng.admin", { width: 1280, height: 1000 });
    await go(p, state.findingUrl);
    await mark(p, [
      [1, main(p).locator("h1").first()],
      [2, main(p).locator("ol[aria-label=\"ลำดับสถานะงานแก้ไข\"]")],
      [3, heading(p, "รายละเอียด"), { corner: "tl" }],
      [4, heading(p, "หลักฐานก่อน–หลังแก้ไข"), { corner: "tl" }],
    ]);
    await shot(p, "20-finding-open");
    await focus(p, heading(p, "มอบหมายผู้รับผิดชอบแก้ไข"));
    const who = main(p).getByLabel(/ผู้รับผิดชอบแก้ไข/);
    await who.selectOption((await who.locator("option", { hasText: "ช่างกองอาคารฯ" }).getAttribute("value")));
    const due = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    await main(p).getByLabel(/กำหนดแล้วเสร็จ/).fill(due);
    await main(p).getByLabel("มาตรการเบื้องต้น").fill("งดใช้ถังนี้ชั่วคราว นำถังสำรองมาวางแทน");
    await mark(p, [[1, who], [2, main(p).getByLabel(/กำหนดแล้วเสร็จ/)], [3, main(p).getByLabel("มาตรการเบื้องต้น")], [4, main(p).getByRole("button", { name: "บันทึกการมอบหมาย" })]]);
    await shot(p, "20-assign-form");
    await main(p).getByRole("button", { name: "บันทึกการมอบหมาย" }).click();
    await p.getByText("มอบหมายงานแก้ไขแล้ว").first().waitFor();
    await p.waitForLoadState("networkidle");
    // ใบงาน
    const woHead = heading(p, "ส่งใบงานไปยังหน่วยงานที่เกี่ยวข้อง");
    if (await woHead.count()) {
      await focus(p, woHead);
      await main(p).getByLabel("รายละเอียดงาน").fill("ขอเติมสารดับเพลิงหรือเปลี่ยนถังดับเพลิงขนาด 15 ปอนด์ 1 ถัง");
      await mark(p, [[1, main(p).getByLabel("หน่วยงานปลายทาง")], [2, main(p).getByLabel("รายละเอียดงาน")], [3, main(p).getByRole("button", { name: "ออกใบงาน" })]]);
      await shot(p, "21-workorder-form");
      await main(p).getByRole("button", { name: "ออกใบงาน" }).click();
      await p.waitForLoadState("networkidle");
      const wo = main(p).locator('a[href*="/work-order/"]').first();
      await wo.waitFor({ timeout: 15000 });
      await go(p, await wo.getAttribute("href"));
      await shot(p, "21-workorder");
    }
    await p.context().close();
  },

  async fixer(b) {
    const m = await open(b, "fixer", MOBILE);
    await go(m, "/findings?mine=1&status=open_all");
    await mark(m, [[1, main(m).getByRole("link", { name: "งานของฉัน" })], [2, main(m).locator(`a[href="${state.findingUrl}"]`).first()]]);
    await shot(m, "22-fixer-list");
    await go(m, state.findingUrl);
    const start = main(m).getByRole("button", { name: "รับงาน / เริ่มแก้ไข" });
    await focus(m, start, 300);
    await mark(m, [[1, start]]);
    await shot(m, "22-fixer-start");
    await start.click();
    await m.getByText(/สถานะ: กำลังแก้ไข/).first().waitFor();
    await go(m, state.findingUrl);
    const prog = main(m).getByPlaceholder("สิ่งที่ดำเนินการแล้ว / อุปสรรค");
    await prog.fill("ตรวจแล้วพบว่าแรงดันรั่ว ส่งถังไปเติมสารที่ร้านคู่สัญญา คาดว่าได้คืนภายใน 3 วัน");
    await main(m).getByLabel("ร้อยละความคืบหน้า").fill("50").catch(() => main(m).getByLabel("ร้อยละความคืบหน้า").selectOption("50"));
    await focus(m, prog, 120);
    await mark(m, [[1, prog], [2, main(m).getByLabel("ร้อยละความคืบหน้า")], [3, main(m).getByRole("button", { name: "บันทึกความคืบหน้า" })]]);
    await shot(m, "23-fixer-progress");
    await main(m).getByRole("button", { name: "บันทึกความคืบหน้า" }).click();
    await m.getByText("บันทึกความคืบหน้าแล้ว").first().waitFor();
    await go(m, state.findingUrl);
    await main(m).locator("input[type=file]").last().setInputFiles(path.join(ASSETS, "after.jpg"));
    await main(m).locator('img[alt="ภาพหลักฐาน"]').last().waitFor({ timeout: 20000 });
    await main(m).getByLabel(/สรุปการแก้ไข/).fill("เติมสารดับเพลิงและเปลี่ยนซีลใหม่ เข็มเกจกลับมาอยู่ในแถบสีเขียว ติดป้ายตรวจสอบแล้ว");
    const after = main(m).getByText("ภาพหลักฐานหลังแก้ไข").first();
    await focus(m, after, 100);
    await mark(m, [[1, after], [2, main(m).getByLabel(/สรุปการแก้ไข/)], [3, main(m).getByRole("button", { name: "ส่งผลแก้ไขให้ตรวจยืนยัน" })]]);
    await shot(m, "24-fixer-submit");
    await main(m).getByRole("button", { name: "ส่งผลแก้ไขให้ตรวจยืนยัน" }).click();
    await m.getByText("ส่งผลการแก้ไขแล้ว รอผู้ตรวจยืนยัน").first().waitFor();
    await go(m, state.findingUrl);
    await mark(m, [[1, main(m).getByText(/ผู้แก้ไขไม่สามารถยืนยันงานของตนเองได้/).first()]]);
    await focus(m, main(m).getByText(/ผู้แก้ไขไม่สามารถยืนยันงานของตนเองได้/), 200);
    await mark(m, [[1, main(m).getByText(/ผู้แก้ไขไม่สามารถยืนยันงานของตนเองได้/).first()]]);
    await shot(m, "24-fixer-waiting");
    await m.context().close();
  },

  async verifier(b) {
    const p = await open(b, "verifier", { width: 1280, height: 900 });
    await go(p, "/findings?group=pending_verification");
    await mark(p, [[1, main(p).getByRole("link", { name: "รอตรวจยืนยัน" })], [2, main(p).locator(`a[href="${state.findingUrl}"]`).first()]]);
    await shot(p, "25-verify-list");
    await go(p, state.findingUrl);
    await focus(p, heading(p, "หลักฐานก่อน–หลังแก้ไข"));
    await mark(p, [[1, main(p).getByText("ก่อนแก้ไข (จากการตรวจ)").first(), { corner: "tl" }], [2, main(p).getByText("หลังแก้ไข", { exact: true }).first(), { corner: "tl" }]]);
    await shot(p, "25-verify-compare");
    const vh = heading(p, "ตรวจยืนยันผลการแก้ไข");
    await focus(p, vh);
    await main(p).getByLabel(/ความเห็น/).fill("ป้ายตรวจสอบยังไม่ระบุวันที่ กรุณาเขียนวันที่ตรวจบนป้ายแล้วถ่ายภาพใหม่");
    await mark(p, [[1, main(p).getByLabel(/ความเห็น/)], [2, main(p).getByRole("button", { name: "ส่งกลับแก้ไข" })], [3, main(p).getByRole("button", { name: "ผ่าน — ปิดงาน" })]]);
    await shot(p, "26-verify-form");
    await main(p).getByRole("button", { name: "ส่งกลับแก้ไข" }).click();
    await p.getByText("ส่งกลับให้แก้ไขเพิ่มเติมแล้ว").first().waitFor();
    await p.context().close();

    // ผู้รับผิดชอบแก้ไขใหม่ (ไม่ถ่ายภาพประกอบ)
    const f = await open(b, "fixer");
    await go(f, state.findingUrl);
    await main(f).locator("input[type=file]").last().setInputFiles(path.join(ASSETS, "after.jpg"));
    await main(f).locator('img[alt="ภาพหลักฐาน"]').last().waitFor({ timeout: 20000 });
    await main(f).getByLabel(/สรุปการแก้ไข/).fill("เขียนวันที่ตรวจบนป้ายแล้ว");
    await main(f).getByRole("button", { name: "ส่งผลแก้ไขให้ตรวจยืนยัน" }).click();
    await f.getByText("ส่งผลการแก้ไขแล้ว รอผู้ตรวจยืนยัน").first().waitFor();
    await f.context().close();

    const v = await open(b, "verifier", { width: 1280, height: 900 });
    await go(v, state.findingUrl);
    await main(v).getByRole("button", { name: "ผ่าน — ปิดงาน" }).click();
    await v.getByText("ตรวจยืนยันผ่าน — ปิดงานแล้ว").first().waitFor();
    await go(v, state.findingUrl);
    await mark(v, [[1, main(v).getByText("งานนี้ผ่านการตรวจยืนยันและปิดงานแล้ว").first()]]);
    await shot(v, "27-closed");
    await focus(v, heading(v, "ประวัติการดำเนินการ"));
    await mark(v, [[1, main(v).getByText("ตรวจยืนยัน: ส่งกลับแก้ไข").first()]]);
    await shot(v, "27-history");
    await v.context().close();
  },

  // ---------- ส่วนที่ 4: ผู้ดูแลคณะ/หน่วยงาน ----------
  async assets(b) {
    const p = await open(b, "eng.admin", { width: 1280, height: 1000 });
    await go(p, "/assets");
    await mark(p, [
      [1, main(p).getByRole("link", { name: /เพิ่มจุดตรวจ/ })],
      [2, main(p).getByRole("button", { name: "กรองข้อมูล" }), { corner: "tr" }],
      [3, main(p).getByPlaceholder(/ค้นหารหัส/)],
      [4, main(p).getByRole("link", { name: /ใกล้หมดอายุ/ })],
      [5, main(p).locator("input[type=checkbox]").first(), { corner: "tl" }],
      [6, main(p).getByRole("button", { name: /พิมพ์ QR ที่เลือก/ }).or(main(p).getByRole("link", { name: /พิมพ์ QR ที่เลือก/ }))],
    ]);
    await shot(p, "30-assets");

    await go(p, "/assets/new");
    const f = (l) => main(p).getByLabel(l, { exact: false }).first();
    await f("รหัสจุดตรวจ/อุปกรณ์").fill("FE-EN1-303");
    await f("ชื่อ").fill("ถังดับเพลิง EN1 ชั้น 3 จุดที่ 3");
    await pick(f("ประเภทอุปกรณ์"), "ถังดับเพลิง");
    await pick(f("อาคาร"), "EN1");
    await p.waitForTimeout(400);
    await pick(f("ชั้น"), "ชั้น 3");
    await p.waitForTimeout(400);
    await pick(f("ห้อง/พื้นที่"), /ทางเดินหลัก/);
    await f("รายละเอียดตำแหน่ง").fill("ข้างลิฟต์โดยสาร ฝั่งทิศเหนือ");
    await f("ยี่ห้อ/รุ่น").fill("ตัวอย่าง ABC 15 ปอนด์");
    await f("หมายเลขเครื่อง").fill("SN-0001234");
    await f("วันที่หมดอายุ").fill("2027-10-31");
    await mark(p, [[1, f("รหัสจุดตรวจ/อุปกรณ์")], [2, f("ประเภทอุปกรณ์")], [3, f("หน่วยงานเจ้าของ")], [4, f("อาคาร")], [5, f("ห้อง/พื้นที่")], [6, f("วันที่หมดอายุ")], [7, f("รอบตรวจ")], [8, f("สถานะ")]]);
    await shot(p, "31-asset-new");
    await main(p).getByRole("button", { name: "บันทึกจุดตรวจ" }).click();
    for (let i = 0; i < 40 && !(await idOf("FE-EN1-303")); i++) await p.waitForTimeout(250);
    state.newAsset = `/assets/${await idOf("FE-EN1-303")}`;
    await p.setViewportSize({ width: 1280, height: 800 });
    await go(p, state.newAsset);
    await mark(p, [[1, main(p).getByText("QR Code", { exact: true }).first(), { corner: "tl" }], [2, main(p).getByRole("link", { name: "พิมพ์ QR" }).first(), { corner: "bl" }], [3, main(p).getByRole("link", { name: "แก้ไข" }).first(), { corner: "bl" }], [4, main(p).getByRole("link", { name: /เริ่มตรวจ/ }).first(), { corner: "bl" }], [5, main(p).getByText("เพิ่มรูป").first(), { corner: "tr" }]]);
    await shot(p, "32-asset-detail");
    await go(p, `/assets/qr?id=${state.newAsset.split("/").pop()}&id=${await idOf("FE-EN1-101")}&id=${await idOf("FE-EN1-102")}`);
    await shot(p, "33-qr-print");
    await p.context().close();
  },

  async plans(b) {
    const p = await open(b, "coordinator", { width: 1280, height: 1000 });
    await go(p, "/plans");
    const f = (l) => main(p).getByLabel(l, { exact: false }).first();
    await f("ชื่อแผน").fill("ตรวจถังดับเพลิงรายเดือน อาคาร EN1");
    await pick(f("แบบตรวจ"), "ถังดับเพลิง");
    await mark(p, [[1, main(p).getByText("สร้างแผนการตรวจใหม่").first(), { corner: "tl" }], [2, f("ชื่อแผน")], [3, f("อาคาร")], [4, f("แบบตรวจ")], [5, f("รอบการตรวจ")], [6, main(p).getByRole("button", { name: /สร้างงานถึงสิ้นปี/ }).first(), { corner: "tl" }]]);
    await shot(p, "34-plans");
    await go(p, "/tasks?status=overdue");
    await main(p).locator("tbody input[type=checkbox]").nth(0).check().catch(() => {});
    await p.evaluate(() => window.scrollTo(0, 0));
    await mark(p, [[1, main(p).getByRole("link", { name: "จัดการแผนการตรวจ" })], [2, main(p).locator("tbody input[type=checkbox]").first(), { corner: "tl" }], [3, main(p).getByLabel(/มอบหมายงานที่เลือกให้/)], [4, main(p).getByRole("button", { name: "มอบหมาย", exact: true })]]);
    await shot(p, "35-tasks");
    await p.context().close();
  },

  // ---------- ส่วนที่ 5: แดชบอร์ดและรายงาน ----------
  async dashboard(b) {
    const p = await open(b, "coordinator", { width: 1280, height: 1100 });
    await go(p, "/");
    await mark(p, [[1, main(p).getByText(/ข้อมูล ณ/).first()], [2, main(p).getByRole("button", { name: "กรองข้อมูล" })], [3, main(p).getByText("ความครอบคลุมการตรวจ", { exact: true }).locator("xpath=ancestor::a[1] | ancestor::div[contains(@class,'rounded')][1]").first()], [4, main(p).getByText("งานตรวจเกินกำหนด", { exact: true }).first().locator("xpath=ancestor::a[1]")]]);
    await shot(p, "40-dashboard");
    const annual = main(p).getByText(/ตารางการตรวจรายปี/).first();
    await focus(p, annual, 40);
    await mark(p, [[1, annual, { corner: "tl" }]]);
    await shot(p, "41-dashboard-annual");
    await go(p, "/reports");
    await mark(p, [[1, main(p).getByLabel("ช่วงเวลา").first()], [2, main(p).getByRole("link", { name: "Excel" }).first()], [3, main(p).getByRole("link", { name: /PDF/ }).first()]]);
    await shot(p, "42-reports");
    await go(p, "/reports/print/monthly");
    await shot(p, "43-report-print");
    await p.context().close();

    const e = await open(b, "executive");
    await go(e, "/");
    await mark(e, [[1, e.getByRole("navigation", { name: "เมนูหลัก" })]]);
    await shot(e, "44-executive");
    await e.context().close();
  },

  // ภาพประกอบหน้าปก (ไม่มีกรอบหมายเลข)
  async cover(b) {
    const p = await open(b, "coordinator");
    await go(p, "/");
    await shot(p, "cover-dashboard");
    await p.context().close();
    const m = await open(b, "inspector.eng", MOBILE);
    await go(m, "/inspect");
    await m.getByRole("button", { name: /เปิดกล้อง/ }).waitFor();
    await shot(m, "cover-mobile");
    await m.context().close();
  },

  // ---------- ส่วนที่ 6: ผู้ดูแลระบบ ----------
  async settings(b) {
    const p = await open(b, "admin", { width: 1280, height: 900 });
    await go(p, "/settings");
    await mark(p, [[1, main(p).getByRole("link", { name: /หน่วยงาน/ }).first()], [2, main(p).getByRole("link", { name: /อาคาร ชั้น และห้อง/ })], [3, main(p).getByRole("link", { name: /ผู้ใช้และสิทธิ์/ })], [4, main(p).getByRole("link", { name: /แบบตรวจ/ }).first()], [5, main(p).getByRole("link", { name: /การแจ้งเตือน/ }).first()], [6, main(p).getByRole("link", { name: /ภาพลักษณ์/ })], [7, main(p).getByRole("link", { name: /ประวัติการใช้งาน/ })]]);
    await shot(p, "50-settings");

    await go(p, "/settings/organizations");
    const f = (l) => main(p).getByLabel(l, { exact: false }).first();
    await f("รหัส").fill("PHS");
    await f("ชื่อ (ไทย)").fill("คณะสาธารณสุขศาสตร์");
    await f("ชื่อ (อังกฤษ)").fill("Faculty of Public Health");
    await mark(p, [[1, main(p).getByText("โครงสร้างหน่วยงาน").first(), { corner: "tl" }], [2, f("สังกัด")], [3, f("รหัส")], [4, f("ชื่อ (ไทย)")], [5, f("ประเภท")], [6, main(p).getByRole("button", { name: "เพิ่มหน่วยงาน" })]]);
    await shot(p, "51-organizations");

    await go(p, "/settings/locations");
    await main(p).getByText("+ เพิ่มอาคาร").first().click().catch(() => {});
    await p.waitForTimeout(300);
    await mark(p, [[1, main(p).getByText("อาคาร", { exact: true }).first(), { corner: "tl" }], [2, main(p).getByText("ชั้น", { exact: true }).first(), { corner: "tl" }], [3, main(p).getByText("ห้อง/พื้นที่", { exact: true }).first(), { corner: "tl" }]]);
    await shot(p, "52-locations");

    await go(p, "/settings/users");
    await mark(p, [[1, main(p).getByPlaceholder(/ค้นหาชื่อ/)], [2, main(p).getByRole("link", { name: /รอกำหนดสิทธิ์/ })], [3, main(p).getByText("+ เพิ่มบทบาท").first(), { corner: "r" }], [4, main(p).getByRole("button", { name: "ระงับ" }).first().or(main(p).getByText("ระงับ", { exact: true }).first())], [5, main(p).getByText("เพิ่มผู้ใช้ใหม่").first(), { corner: "tl" }]]);
    await shot(p, "53-users");
    // ผู้ใช้ใหม่ที่เข้าสู่ระบบด้วย Google ครั้งแรก → กำหนดบทบาท
    await main(p).getByRole("link", { name: /รอกำหนดสิทธิ์/ }).click();
    await p.waitForLoadState("networkidle");
    const row = main(p).locator("tr", { hasText: "newstaff@demo.example.com" });
    await row.getByText("+ เพิ่มบทบาท").click();
    const sel = row.locator("details[open] select");
    await pick(sel.nth(0), /^ผู้ตรวจ$/);
    await pick(sel.nth(1), "วิศวกรรม");
    await mark(p, [[1, row.getByText("รอกำหนดสิทธิ์").first()], [2, sel.nth(0)], [3, sel.nth(1)], [4, row.getByRole("button", { name: "เพิ่ม", exact: true })]]);
    await shot(p, "54-users-addrole");
    await row.getByRole("button", { name: "เพิ่ม", exact: true }).click();
    await p.waitForLoadState("networkidle");
    await p.waitForTimeout(800);
    await go(p, "/settings/checklists");
    await mark(p, [[1, main(p).getByText("ร่างสำหรับผู้เชี่ยวชาญตรวจรับรอง").first()], [2, main(p).getByText("สร้างแบบตรวจใหม่").first(), { corner: "tl" }]]);
    await shot(p, "55-checklists");
    await main(p).getByRole("link", { name: /ถังดับเพลิง/ }).first().click();
    await p.waitForLoadState("networkidle");
    await mark(p, [[1, main(p).getByText(/ใช้งานอยู่/).first(), { corner: "tr" }], [2, main(p).getByRole("button", { name: "สร้างเวอร์ชันใหม่เพื่อแก้ไข" })], [3, main(p).locator("main li, main ol > *").first().or(main(p).getByText(/^1\./).first()), { corner: "tl" }], [4, main(p).getByText("ร่างสำหรับผู้เชี่ยวชาญตรวจรับรอง").first()]]);
    await shot(p, "56-checklist-detail");

    await go(p, "/settings/notifications");
    await mark(p, [[1, main(p).getByText("ค่าตั้งต้นของมหาวิทยาลัย").first(), { corner: "tl" }], [2, main(p).getByText(/ค่าเฉพาะหน่วยงาน/).first(), { corner: "tl" }]]);
    await shot(p, "57-notifications");
    await go(p, "/settings/branding");
    await mark(p, [[1, main(p).getByLabel(/โดเมนอีเมล/)], [2, main(p).getByLabel(/ไฟล์ตรา/)]]);
    await shot(p, "58-branding");
    await go(p, "/settings/audit");
    await shot(p, "59-audit");
    await p.context().close();
  },
};
async function idOf(code) {
  const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env.e2e"), "utf8").split("\n").filter(Boolean).map((l) => l.split(/=(.*)/s).slice(0, 2)));
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/assets?code=eq.${code}&select=id`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
  return (await r.json())[0]?.id;
}
const statePath = path.join(OUT, "..", ".capture-state.json");
if (fs.existsSync(statePath)) Object.assign(state, JSON.parse(fs.readFileSync(statePath, "utf8")));

const browser = await chromium.launch();
try {
  for (const [name, fn] of Object.entries(groups)) {
    if (only.size && !only.has(name)) continue;
    await fn(browser);
  }
} finally {
  await browser.close();
}
// ลดขนาดไฟล์ภาพ (256 สี) เพื่อให้ PDF ไม่ใหญ่เกินไป
execFileSync("python3", ["-c", `
import sys, glob
from PIL import Image
for f in glob.glob(sys.argv[1] + "/*.png"):
    im = Image.open(f)
    if im.mode != "P":
        im.convert("RGB").quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(f, optimize=True)
`, OUT]);
