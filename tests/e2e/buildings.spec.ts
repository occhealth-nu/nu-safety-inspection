import { test, expect, type Browser, type BrowserContextOptions } from "@playwright/test";
import path from "node:path";

// ระบบตรวจสอบความปลอดภัยอาคาร: สโคปพื้นที่ (วิทยาเขต → โซน → อาคาร → ชั้น → ห้อง → จุดตรวจ) ผังชั้น หมุด และพิกัดผู้ตรวจ
const PASS = process.env.DEMO_PASSWORD ?? "Demo-Only-Pass-2569";
const PLAN = path.resolve(__dirname, "../manual/assets/plan-floor.png");
// พิกัดอาคารตัวอย่าง EN1 ใน seed = 16.745300, 100.197400
const NEAR_EN1 = { latitude: 16.7454, longitude: 100.1973, accuracy: 12 };
const FAR_AWAY = { latitude: 13.7563, longitude: 100.5018, accuracy: 20 };   // กรุงเทพฯ

async function login(browser: Browser, user: string, opts: BrowserContextOptions = {}) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator("summary", { hasText: "อีเมลและรหัสผ่าน" }).click();
  await page.getByLabel("อีเมล").fill(`${user}@demo.example.com`);
  await page.getByLabel("รหัสผ่าน").fill(PASS);
  await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  return page;
}

async function inspectAllPass(page: import("@playwright/test").Page, failFirst: boolean) {
  const items = page.locator("ol > li[id^=item-]");
  await items.nth(1).waitFor();
  const n = await items.count();
  for (let i = 0; i < n; i++) {
    const it = items.nth(i);
    if (i === 0 && failFirst) {
      await it.getByRole("radio", { name: "ไม่ผ่าน", exact: true }).click();
      await it.getByPlaceholder("สิ่งที่พบ ตำแหน่ง และความเสี่ยง").fill("ทดสอบตำแหน่ง: พบข้อบกพร่อง");
      await it.getByRole("button", { name: "สูง (เร่งด่วน)" }).click();
      await it.getByLabel(/ถ่ายภาพไม่ได้/).fill("ทดสอบ: พื้นที่ห้ามถ่ายภาพ");
    } else {
      const ok = it.getByRole("radio", { name: "ผ่าน", exact: true });
      for (let t = 0; t < 3 && (await ok.getAttribute("aria-checked")) !== "true"; t++) await ok.click();
    }
  }
}

test.describe.serial("อาคารและพื้นที่: สโคป ผังชั้น หมุด และพิกัด", () => {
  let en1 = "";
  let findingUrl = "";

  test("ภาพรวมรายอาคารจัดกลุ่ม วิทยาเขต → โซน และกรองตามโซนได้", async ({ browser }) => {
    const page = await login(browser, "coordinator");
    await page.getByRole("navigation", { name: "เมนูหลัก" }).getByRole("link", { name: "อาคารและพื้นที่" }).click();
    await expect(page.getByRole("heading", { name: /วิทยาเขตหลัก พิษณุโลก/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /โซนวิศวกรรมและวิทยาศาสตร์/ })).toBeVisible();
    await expect(page.locator("[data-building]")).toHaveCount(3);
    en1 = (await page.locator('[data-building="EN1"] a').first().getAttribute("href"))!.split("/").pop()!;
    await page.getByLabel("โซน").selectOption({ label: "โซนสำนักงานกลาง (ตัวอย่าง)" });
    await page.getByRole("button", { name: "กรองข้อมูล" }).click();
    await expect(page.locator("[data-building]")).toHaveCount(1);
    await expect(page.locator('[data-building="QS"]')).toBeVisible();
    // ตัวกรองสโคปเดียวกันใช้กับแดชบอร์ด
    await page.goto("/?zone=22000000-0000-0000-0000-000000000002");
    await expect(page.getByText("ความครอบคลุมการตรวจ", { exact: true })).toBeVisible();
    await page.context().close();
  });

  test("ผู้ดูแลคณะอัปโหลดผังชั้น ระบุพิกัดอาคาร และเห็นหมุดจุดตรวจบนผัง", async ({ browser }) => {
    const page = await login(browser, "eng.admin", { permissions: ["geolocation"], geolocation: NEAR_EN1 });
    await page.goto(`/settings/locations?building=${en1}`);
    await page.waitForLoadState("networkidle");
    const floor1 = page.locator('[data-testid="floor-list"] li').first();
    await floor1.locator('input[type=file]').setInputFiles(PLAN);
    await expect(page.getByText("บันทึกผังชั้นแล้ว")).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="floor-list"] li').first().locator("img")).toBeVisible();
    // พิกัดอาคารด้วยปุ่ม “ใช้ตำแหน่งปัจจุบัน”
    const form = page.locator("form", { has: page.locator('input[name="address"]') }).last();
    await form.getByRole("button", { name: "ใช้ตำแหน่งปัจจุบัน" }).click();
    await expect(form.locator('input[name="latitude"]')).toHaveValue("16.745400");
    await form.getByRole("button", { name: "บันทึก", exact: true }).click();
    await expect(page.getByText("บันทึกตำแหน่งอาคารแล้ว")).toBeVisible();

    await page.goto(`/buildings/${en1}`);
    await expect(page.locator('[data-testid="floor-plan"] img')).toBeVisible();
    expect(await page.locator("[data-testid=floor-plan] [data-pin]").count()).toBeGreaterThan(3);
    await expect(page.getByRole("link", { name: /แผนที่\/นำทาง/ })).toHaveAttribute("href", /16\.745400,100\.197300/);
    await page.context().close();
  });

  test("ผู้ดูแลปักหมุดจุดตรวจบนผัง แล้วหน้าจุดตรวจแสดงตำแหน่ง", async ({ browser }) => {
    const page = await login(browser, "eng.admin");
    await page.goto("/assets?q=FE-EN1-102");
    const assetUrl = (await page.getByRole("link", { name: /FE-EN1-102/ }).first().getAttribute("href"))!;
    await page.goto(assetUrl + "/edit");
    await page.waitForLoadState("networkidle");
    const picker = page.getByTestId("plan-picker");
    const box = (await picker.boundingBox())!;
    await picker.click({ position: { x: box.width * 0.5, y: box.height * 0.5 } });
    await expect(page.getByText(/ปักหมุดที่ X 5\d/)).toBeVisible();
    await page.getByRole("button", { name: "บันทึกจุดตรวจ" }).click();
    await page.waitForURL(/\?saved=1/);
    const card = page.locator("section, div").filter({ has: page.getByText("หมุดกะพริบ = ตำแหน่งของจุดตรวจนี้") }).last();
    await expect(card.locator("[data-pin]")).toHaveCount(1);
    await expect(page.getByRole("link", { name: /นำทางไปยังอาคาร/ })).toBeVisible();
    await page.context().close();
  });

  test("ผู้ตรวจส่งผลที่หน้างาน: ระบบบันทึกพิกัดและยืนยันว่าอยู่ในพื้นที่", async ({ browser }) => {
    const page = await login(browser, "inspector.eng", { permissions: ["geolocation"], geolocation: NEAR_EN1, viewport: { width: 390, height: 844 } });
    await page.goto("/q/lookup?code=FE-EN1-101");
    await expect(page.getByText(/หมุดกะพริบ|ยังไม่ได้ปักหมุด/)).toBeVisible();
    await page.goto((await page.locator("main").getByRole("link", { name: /เริ่มตรวจ/ }).first().getAttribute("href"))!);
    await page.waitForURL(/\/inspect\/[0-9a-f-]{36}$/);
    await expect(page.getByText(/ระบบจะขอพิกัดตำแหน่งของเครื่องหนึ่งครั้ง/)).toBeVisible();
    await inspectAllPass(page, true);
    await page.getByRole("button", { name: "ส่งผลตรวจ" }).click();
    await page.waitForURL(/\/inspections\/[0-9a-f-]{36}\?submitted=1/, { timeout: 30000 });
    await expect(page.getByTestId("geo-status")).toContainText("อยู่ในพื้นที่ตรวจ");
    findingUrl = (await page.locator('main a[href^="/findings/"]').first().getAttribute("href"))!;
    await page.context().close();
  });

  test("ส่งผลจากที่อื่น (ห่างหลายกิโลเมตร) ระบบทำเครื่องหมายนอกพื้นที่", async ({ browser }) => {
    const page = await login(browser, "inspector.eng", { permissions: ["geolocation"], geolocation: FAR_AWAY });
    await page.goto("/q/lookup?code=EL-EN1-101");
    await page.goto((await page.locator("main").getByRole("link", { name: /เริ่มตรวจ/ }).first().getAttribute("href"))!);
    await page.waitForURL(/\/inspect\/[0-9a-f-]{36}$/);
    await inspectAllPass(page, false);
    await page.getByRole("button", { name: "ส่งผลตรวจ" }).click();
    await page.waitForURL(/\/inspections\/[0-9a-f-]{36}\?submitted=1/, { timeout: 30000 });
    await expect(page.getByTestId("geo-status")).toContainText("นอกรัศมี");
    await expect(page.getByTestId("geo-status")).toContainText("กม.");
    await page.context().close();
  });

  test("ผู้ตรวจที่พบปักหมุดตำแหน่งข้อบกพร่องจริงบนผัง", async ({ browser }) => {
    const page = await login(browser, "inspector.eng");
    await page.goto(findingUrl);
    await page.waitForLoadState("networkidle");
    // ข้อบกพร่องได้หมุดตั้งต้นจากจุดตรวจแล้ว → เปิดส่วนแก้ไขตำแหน่ง
    await page.getByText("ปักหมุด/แก้ไขตำแหน่งที่พบจริงบนผัง").click();
    const picker = page.getByTestId("plan-picker");
    const box = (await picker.boundingBox())!;
    await picker.click({ position: { x: box.width * 0.2, y: box.height * 0.3 } });
    await page.getByPlaceholder(/ผนังด้านทิศเหนือ/).fill("มุมบันไดหนีไฟ");
    await page.getByRole("button", { name: "บันทึกตำแหน่ง" }).click();
    await expect(page.getByText("บันทึกตำแหน่งข้อบกพร่องแล้ว")).toBeVisible();
    await expect(page.getByText("จุดที่พบ: มุมบันไดหนีไฟ")).toBeVisible();
    await page.goto(`/buildings/${en1}`);
    await expect(page.locator(`[data-pin="${findingUrl.split("/").pop()}"]`)).toBeVisible();
    await page.context().close();
  });

  test("ผู้ไม่มีสิทธิ์ในอาคารเปิดผังอาคารไม่ได้ และรายงานรายอาคารดาวน์โหลดได้", async ({ browser }) => {
    const sci = await login(browser, "inspector.sci");
    await sci.goto(`/buildings/${en1}`);
    await expect(sci.getByText("อาคารนี้อยู่นอกขอบเขตสิทธิ์ของคุณ")).toBeVisible();
    await sci.context().close();
    const page = await login(browser, "executive");
    const res = await page.request.get("/api/reports/buildings?zone=22000000-0000-0000-0000-000000000001");
    expect(res.status()).toBe(200);
    expect((await res.body()).subarray(0, 2).toString()).toBe("PK");
    await page.goto("/reports/print/buildings");
    await expect(page.getByText("สรุปความปลอดภัยรายอาคาร")).toBeVisible();
    await page.context().close();
  });
});
