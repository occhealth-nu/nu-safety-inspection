import { test, expect, type Page, type Browser } from "@playwright/test";
import fs from "node:fs";

const PASS = process.env.DEMO_PASSWORD ?? "Demo-Only-Pass-2569";
const SHOTS = process.env.E2E_SHOTS_DIR;
// ภาพ PNG ขนาดเล็ก (1x1) สำหรับทดสอบการแนบภาพ
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function login(browser: Browser, user: string, viewport?: { width: number; height: number }) {
  const ctx = await browser.newContext(viewport ? { viewport, isMobile: true, hasTouch: true } : {});
  const page = await ctx.newPage();
  await page.goto("/login");
  await openPasswordLogin(page);
  await page.getByLabel("อีเมล").fill(`${user}@demo.example.com`);
  await page.getByLabel("รหัสผ่าน").fill(PASS);
  await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  return page;
}
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

test.describe.serial("วงจรครบ: ตรวจ → พบปัญหา → มอบหมาย → แก้ไข → ส่งกลับ → แก้ไขใหม่ → ตรวจยืนยัน → Dashboard", () => {
  let findingUrl = "";
  let assetUrl = "";
  let qrPath = "";

  test("ผู้ตรวจเลือกงาน ตรวจ แนบภาพ และส่งผล", async ({ browser }) => {
    const page = await login(browser, "inspector.eng", { width: 390, height: 844 });
    await page.goto("/inspect");
    await shot(page, "01-inspect-mobile");
    await page.locator('a[href^="/inspect/start?asset="]', { hasText: "-EN1-" }).first().click();
    await page.waitForURL(/\/inspect\/[0-9a-f-]{36}$/);
    const items = page.locator("ol > li[id^=item-]");
    const n = await items.count();
    expect(n).toBeGreaterThan(2);
    // ส่งโดยยังไม่ครบ → ต้องไม่สำเร็จ และไม่แสดงว่าบันทึกแล้ว
    await page.getByRole("button", { name: "ส่งผลตรวจ" }).click();
    await expect(page.getByText(/ยังกรอกข้อมูลไม่ครบ/)).toBeVisible();
    for (let i = 1; i < n; i++) {
      const it = items.nth(i);
      const na = it.getByRole("radio", { name: "ไม่เกี่ยวข้อง", exact: true });
      if (i === n - 1 && (await na.count())) {
        await na.click();
        await it.getByPlaceholder("เช่น ถังชนิดนี้ไม่มีเกจวัด").fill("ทดสอบ: ไม่มีส่วนประกอบนี้");
      } else {
        await it.getByRole("radio", { name: "ผ่าน", exact: true }).click();
      }
    }
    const first = items.first();
    await first.getByRole("radio", { name: "ไม่ผ่าน", exact: true }).click();
    await first.getByPlaceholder("สิ่งที่พบ ตำแหน่ง และความเสี่ยง").fill("ทดสอบ E2E: พบความเสียหายที่ต้องแก้ไข");
    await first.getByRole("button", { name: SEVERITY("high") }).click();
    await first.locator('input[type=file]').setInputFiles({ name: "evidence.png", mimeType: "image/png", buffer: PNG });
    await expect(first.locator('img[alt="ภาพหลักฐาน"]')).toBeVisible({ timeout: 15000 });
    await shot(page, "02-inspection-form-mobile");
    await page.getByRole("button", { name: "ส่งผลตรวจ" }).click();
    await page.waitForURL(/\/inspections\/[0-9a-f-]{36}\?submitted=1/);
    await expect(page.getByText("ระบบบันทึกผลตรวจเรียบร้อยแล้ว")).toBeVisible();
    await expect(page.getByText(/สร้างรายการข้อบกพร่อง 1 รายการ/)).toBeVisible();
    await shot(page, "03-inspection-result");
    const link = page.locator('a[href^="/findings/"]').first();
    findingUrl = (await link.getAttribute("href"))!;
    assetUrl = (await page.locator('a[href^="/assets/"]').first().getAttribute("href"))!;
    await page.goto(assetUrl);
    const qrText = await page.locator("text=/\\/q\\/[0-9a-f]+/").first().innerText();
    qrPath = new URL(qrText.trim()).pathname;
    await page.context().close();
  });

  test("สิทธิ์ข้ามหน่วยงาน: ผู้ตรวจคณะวิทยาศาสตร์เข้าถึงจุดตรวจ/ข้อบกพร่องของวิศวฯ ไม่ได้", async ({ browser }) => {
    const page = await login(browser, "inspector.sci");
    await page.goto(qrPath);
    await expect(page.getByText(/ไม่พบจุดตรวจนี้ หรือจุดตรวจอยู่นอกขอบเขตสิทธิ์ของคุณ/)).toBeVisible();
    await page.goto(findingUrl);
    await expect(page.getByText(/นอกขอบเขตสิทธิ์/)).toBeVisible();
    await page.goto(`/inspect/start?asset=${assetUrl.split("/").pop()}`);
    await expect(page.getByText("ไม่มีสิทธิ์ตรวจจุดตรวจนี้")).toBeVisible();
    await page.context().close();
  });

  test("QR ต้องเข้าสู่ระบบก่อน", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(qrPath);
    await expect(page).toHaveURL(/\/login\?next=/);
    await ctx.close();
  });

  test("ผู้ดูแลคณะมอบหมายผู้รับผิดชอบ", async ({ browser }) => {
    const page = await login(browser, "eng.admin");
    await page.goto(findingUrl);
    await expect(page.getByText("พบข้อบกพร่อง (รอมอบหมาย)").first()).toBeVisible();
    const who = page.getByLabel(/ผู้รับผิดชอบแก้ไข/);
    await who.selectOption((await who.locator("option", { hasText: "ช่างกองอาคารฯ" }).getAttribute("value"))!);
    const due = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    await page.getByLabel(/กำหนดแล้วเสร็จ/).fill(due);
    await page.getByLabel("มาตรการเบื้องต้น").fill("กั้นพื้นที่ชั่วคราว");
    await page.getByRole("button", { name: "บันทึกการมอบหมาย" }).click();
    await expect(page.getByText("มอบหมายงานแก้ไขแล้ว")).toBeVisible();
    await page.context().close();
  });

  test("ผู้รับผิดชอบรับงาน แนบภาพหลังแก้ไข และส่งผล", async ({ browser }) => {
    const page = await login(browser, "fixer");
    await page.goto("/notifications");
    await expect(page.getByText("ได้รับมอบหมายงานแก้ไข").first()).toBeVisible();
    await page.goto(findingUrl);
    await page.getByRole("button", { name: "รับงาน / เริ่มแก้ไข" }).click();
    await expect(page.getByText(/สถานะ: กำลังแก้ไข/)).toBeVisible();
    await page.reload();
    await page.getByPlaceholder("สิ่งที่ดำเนินการแล้ว / อุปสรรค").fill("สั่งซื้ออะไหล่แล้ว");
    await page.getByRole("button", { name: "บันทึกความคืบหน้า" }).click();
    await expect(page.getByText("บันทึกความคืบหน้าแล้ว")).toBeVisible();
    // ส่งโดยไม่มีภาพ → ระบบปฏิเสธ
    await page.getByLabel(/สรุปการแก้ไข/).fill("แก้ไขแล้ว");
    await page.getByRole("button", { name: "ส่งผลแก้ไขให้ตรวจยืนยัน" }).click();
    await expect(page.getByText(/กรุณาแนบภาพหลังแก้ไข/)).toBeVisible();
    await page.locator('input[type=file]').setInputFiles({ name: "after.png", mimeType: "image/png", buffer: PNG });
    await expect(page.locator('img[alt="ภาพหลักฐาน"]').last()).toBeVisible({ timeout: 15000 });
    await page.getByLabel(/สรุปการแก้ไข/).fill("เปลี่ยนอุปกรณ์ใหม่แล้ว");
    await page.getByRole("button", { name: "ส่งผลแก้ไขให้ตรวจยืนยัน" }).click();
    await expect(page.getByText("ส่งผลการแก้ไขแล้ว รอผู้ตรวจยืนยัน")).toBeVisible();
    await page.reload();
    await expect(page.getByText(/ผู้แก้ไขไม่สามารถยืนยันงานของตนเองได้/)).toBeVisible();
    await page.context().close();
  });

  test("ผู้ตรวจยืนยันส่งกลับ (ต้องมีเหตุผล)", async ({ browser }) => {
    const page = await login(browser, "verifier");
    await page.goto(findingUrl);
    await page.getByRole("button", { name: "ส่งกลับแก้ไข" }).click();
    await expect(page.getByText("กรุณาระบุเหตุผลที่ส่งกลับแก้ไข")).toBeVisible();
    await page.getByLabel(/ความเห็น/).fill("ยังไม่ติดป้ายบอกตำแหน่ง");
    await page.getByRole("button", { name: "ส่งกลับแก้ไข" }).click();
    await expect(page.getByText("ส่งกลับให้แก้ไขเพิ่มเติมแล้ว")).toBeVisible();
    await page.context().close();
  });

  test("ผู้รับผิดชอบแก้ไขใหม่ → ผู้ตรวจยืนยันอนุมัติปิดงาน", async ({ browser }) => {
    const fixer = await login(browser, "fixer");
    await fixer.goto(findingUrl);
    await expect(fixer.getByText("ส่งกลับแก้ไข 1 ครั้ง")).toBeVisible();
    await fixer.getByLabel(/สรุปการแก้ไข/).fill("ติดป้ายแล้ว");
    await fixer.getByRole("button", { name: "ส่งผลแก้ไขให้ตรวจยืนยัน" }).click();
    await expect(fixer.getByText(/กรุณาแนบภาพหลังแก้ไข/)).toBeVisible();   // ต้องมีหลักฐานใหม่หลังถูกส่งกลับ
    await fixer.locator('input[type=file]').setInputFiles({ name: "after2.png", mimeType: "image/png", buffer: PNG });
    await expect(fixer.locator('img[alt="ภาพหลักฐาน"]').nth(2)).toBeVisible({ timeout: 15000 });
    await fixer.getByLabel(/สรุปการแก้ไข/).fill("ติดป้ายแล้ว");
    await fixer.getByRole("button", { name: "ส่งผลแก้ไขให้ตรวจยืนยัน" }).click();
    await expect(fixer.getByText("ส่งผลการแก้ไขแล้ว รอผู้ตรวจยืนยัน")).toBeVisible();
    await fixer.context().close();

    const v = await login(browser, "verifier");
    await v.goto(findingUrl);
    await v.getByRole("button", { name: "ผ่าน — ปิดงาน" }).click();
    await expect(v.getByText("ตรวจยืนยันผ่าน — ปิดงานแล้ว")).toBeVisible();
    await v.reload();
    await expect(v.getByText("งานนี้ผ่านการตรวจยืนยันและปิดงานแล้ว")).toBeVisible();
    await expect(v.getByText("ตรวจยืนยัน: ส่งกลับแก้ไข")).toBeVisible();
    await shot(v, "04-finding-closed");
    await v.context().close();
  });

  test("Dashboard, ตารางรายปี, QR, รายงาน Excel", async ({ browser }) => {
    const page = await login(browser, "coordinator");
    await page.goto("/");
    await expect(page.getByText("ความครอบคลุมการตรวจ", { exact: true })).toBeVisible();
    await expect(page.getByText(/ข้อมูล ณ/)).toBeVisible();
    await expect(page.getByText(/ตารางการตรวจรายปี พ.ศ. 2569/)).toBeVisible();
    await shot(page, "05-dashboard");
    await page.getByRole("link", { name: /งานตรวจเกินกำหนด/ }).click();
    await expect(page).toHaveURL(/\/tasks\?.*status=overdue/);
    await expect(page.getByText("เกินกำหนด").first()).toBeVisible();
    await page.goto(`${assetUrl.replace("/assets/", "/assets/qr?id=")}`);
    await expect(page.locator("svg").first()).toBeVisible();
    await shot(page, "06-qr-print");
    const res = await page.request.get("/api/reports/corrective?from=2026-01-01&to=2026-12-31");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("spreadsheetml");
    expect((await res.body()).subarray(0, 2).toString()).toBe("PK");
    await page.goto("/reports/print/monthly?from=2026-01-01&to=2026-12-31");
    await expect(page.getByText("รายงานสรุปรายเดือน")).toBeVisible();
    await page.context().close();
  });

  test("ผู้บริหารเห็น Dashboard แต่ไม่มีเมนูตั้งค่า/เริ่มตรวจ", async ({ browser }) => {
    const page = await login(browser, "executive");
    await expect(page.getByText("ความครอบคลุมการตรวจ", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "ตั้งค่าระบบ" })).toHaveCount(0);
    await page.goto("/settings/users");
    await expect(page.getByRole("heading", { name: "ไม่มีสิทธิ์เข้าถึง" })).toBeVisible();
    await page.context().close();
  });
});

function SEVERITY(k: "high") { return { high: "สูง (เร่งด่วน)" }[k]; }

async function openPasswordLogin(page: import("@playwright/test").Page) {
  const summary = page.locator("summary", { hasText: "อีเมลและรหัสผ่าน" });
  if (await summary.count()) await summary.click();
}
