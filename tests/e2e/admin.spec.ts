import { test, expect, type Browser } from "@playwright/test";

const PASS = process.env.DEMO_PASSWORD ?? "Demo-Only-Pass-2569";
async function login(browser: Browser, user: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  await openPasswordLogin(page);
  await page.getByLabel("อีเมล").fill(`${user}@demo.example.com`);
  await page.getByLabel("รหัสผ่าน").fill(PASS);
  await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  return page;
}

test("ผู้ดูแลคณะ: สร้างจุดตรวจ → พิมพ์ QR → สร้างแผนการตรวจและงานตรวจ", async ({ browser }) => {
  const page = await login(browser, "eng.admin");
  const code = `E2E-${Date.now().toString(36).toUpperCase()}`;
  await page.goto("/assets/new");
  await page.getByLabel(/รหัสจุดตรวจ/).fill(code);
  await page.getByLabel(/^ชื่อ/).fill("ถังดับเพลิงทดสอบ E2E");
  const type = page.getByLabel(/ประเภทอุปกรณ์/);
  await type.selectOption((await type.locator("option", { hasText: "ถังดับเพลิง" }).getAttribute("value"))!);
  const b = page.getByLabel(/^อาคาร/);
  await b.selectOption((await b.locator("option", { hasText: "EN1" }).getAttribute("value"))!);
  await page.getByLabel(/วันที่หมดอายุ/).fill("2028-01-31");
  await page.getByRole("button", { name: "บันทึกจุดตรวจ" }).click();
  await page.waitForURL(/\/assets\/[0-9a-f-]{36}\?saved=1/);
  await expect(page.getByText("บันทึกข้อมูลจุดตรวจแล้ว")).toBeVisible();
  await expect(page.locator("svg").first()).toBeVisible();
  const assetId = page.url().split("/assets/")[1].split("?")[0];
  // พิมพ์ QR: แสดงรหัสที่อ่านได้ด้วยตา
  await page.goto(`/assets/qr?id=${assetId}`);
  await expect(page.getByText(code, { exact: true })).toBeVisible();
  // รหัสซ้ำต้องถูกปฏิเสธ
  await page.goto("/assets/new");
  await page.getByLabel(/รหัสจุดตรวจ/).fill(code);
  await page.getByLabel(/^ชื่อ/).fill("ซ้ำ");
  await type.selectOption((await type.locator("option", { hasText: "ถังดับเพลิง" }).getAttribute("value"))!);
  await b.selectOption((await b.locator("option", { hasText: "EN1" }).getAttribute("value"))!);
  await page.getByRole("button", { name: "บันทึกจุดตรวจ" }).click();
  await expect(page.getByText(/ข้อมูลซ้ำ/)).toBeVisible();
  // แผนการตรวจรายสัปดาห์ เฉพาะอาคาร EN1 + ถังดับเพลิง
  await page.goto("/plans");
  await page.getByLabel(/ชื่อแผน/).fill(`แผนทดสอบ ${code}`);
  const pb = page.getByLabel(/^อาคาร/);
  await pb.selectOption((await pb.locator("option", { hasText: "EN1" }).getAttribute("value"))!);
  const pt = page.getByLabel(/ประเภทอุปกรณ์/);
  await pt.selectOption((await pt.locator("option", { hasText: "ถังดับเพลิง" }).getAttribute("value"))!);
  await page.getByLabel(/รอบการตรวจ/).selectOption("weekly");
  await page.getByLabel(/วันเริ่ม/).fill(new Date().toISOString().slice(0, 10));
  await page.getByRole("button", { name: "บันทึกแผนและสร้างงานตรวจ" }).click();
  await expect(page.getByText(/บันทึกแผนแล้ว และสร้างงานตรวจ \d+ งาน/)).toBeVisible();
  await page.goto(`/tasks?q=${code}`);
  await expect(page.getByText(code).first()).toBeVisible();
  await page.context().close();
});

const PAGES: Record<string, string[]> = {
  admin: ["/", "/tasks", "/plans", "/inspect", "/assets", "/findings", "/reports", "/reports/annual", "/notifications", "/settings",
    "/settings/organizations", "/settings/locations", "/settings/users", "/settings/checklists", "/settings/notifications", "/settings/branding", "/settings/audit"],
  executive: ["/", "/tasks", "/assets", "/findings", "/reports"],
  "inspector.sci": ["/", "/inspect", "/tasks", "/findings"],
  fixer: ["/", "/findings?mine=1&status=open_all", "/notifications"],
};
for (const [user, paths] of Object.entries(PAGES)) {
  test(`ทุกหน้าโหลดได้โดยไม่เกิดข้อผิดพลาด: ${user}`, async ({ browser }) => {
    const page = await login(browser, user);
    for (const p of paths) {
      const t0 = Date.now();
      const res = await page.goto(p);
      console.log(`  ${user} ${p} ${Date.now() - t0}ms`);
      expect(res?.status(), p).toBeLessThan(400);
      await expect(page.getByText("เกิดข้อผิดพลาดในการแสดงหน้านี้"), p).toHaveCount(0);
      await expect(page.getByText("ไม่สามารถโหลดข้อมูลได้"), p).toHaveCount(0);
    }
    await page.context().close();
  });
}

test("checklist: สร้างเวอร์ชันใหม่ แก้รายการ และเผยแพร่", async ({ browser }) => {
  const page = await login(browser, "coordinator");
  await page.goto("/settings/checklists");
  await page.getByRole("link", { name: /ตู้สายฉีดน้ำดับเพลิง/ }).click();
  await page.waitForURL(/\/settings\/checklists\/[0-9a-f-]{36}/);
  const newBtn = page.getByRole("button", { name: "สร้างเวอร์ชันใหม่เพื่อแก้ไข" });
  if (await newBtn.count()) { await newBtn.click(); await expect(page.getByText(/สร้างเวอร์ชันร่างใหม่แล้ว/)).toBeVisible(); }
  await page.getByLabel(/หัวข้อการตรวจ/).last().fill("ข้อทดสอบเพิ่มใหม่ (E2E)");
  await page.getByRole("button", { name: "เพิ่มรายการ" }).click();
  await expect(page.getByText("บันทึกรายการตรวจแล้ว")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "เผยแพร่เวอร์ชันนี้" }).click();
  await expect(page.getByText(/เผยแพร่แล้ว — การตรวจใหม่จะใช้เวอร์ชันนี้/)).toBeVisible();
  await page.context().close();
});

test("ผู้ใช้เปลี่ยนรหัสผ่านเองได้ และต้องยืนยันรหัสผ่านเดิม", async ({ browser }) => {
  const page = await login(browser, "sci.admin");
  await page.goto("/account");
  await page.getByLabel(/รหัสผ่านเดิม/).fill("wrong-password-123");
  await page.getByLabel(/^รหัสผ่านใหม่/).fill("New-Pass-2569-ok");
  await page.getByLabel(/ยืนยันรหัสผ่านใหม่/).fill("New-Pass-2569-ok");
  await page.getByRole("button", { name: "เปลี่ยนรหัสผ่าน" }).click();
  await expect(page.getByText("รหัสผ่านเดิมไม่ถูกต้อง")).toBeVisible();
  await page.getByLabel(/รหัสผ่านเดิม/).fill(PASS);
  await page.getByRole("button", { name: "เปลี่ยนรหัสผ่าน" }).click();
  await expect(page.getByText("เปลี่ยนรหัสผ่านเรียบร้อยแล้ว")).toBeVisible();
  await page.context().close();
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await p2.goto("/login");
  await openPasswordLogin(p2);
  await p2.getByLabel("อีเมล").fill("sci.admin@demo.example.com");
  await p2.getByLabel("รหัสผ่าน").fill("New-Pass-2569-ok");
  await p2.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await p2.waitForURL((u) => !u.pathname.startsWith("/login"));
  await ctx.close();
});

async function openPasswordLogin(page: import("@playwright/test").Page) {
  const summary = page.locator("summary", { hasText: "อีเมลและรหัสผ่าน" });
  if (await summary.count()) await summary.click();
}
