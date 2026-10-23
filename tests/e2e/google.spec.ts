import { test, expect } from "@playwright/test";

const PASS = process.env.DEMO_PASSWORD ?? "Demo-Only-Pass-2569";

test("ปุ่มเข้าสู่ระบบด้วย Google ส่งไปหน้า Google พร้อมจำกัดโดเมน hd=nu.ac.th", async ({ page }) => {
  // ดักการไปยัง Google (ไม่ส่งคำขอออกนอกเครื่อง) แล้วตรวจพารามิเตอร์ที่ Supabase Auth สร้าง
  let googleUrl = "";
  page.on("request", (r) => { if (!googleUrl && r.url().startsWith("https://accounts.google.com/o/oauth2")) googleUrl = r.url(); });
  await page.context().route(/accounts\.google\.com/, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "google-stub" }));
  await page.goto("/login");
  const btn = page.getByRole("button", { name: /เข้าสู่ระบบด้วยบัญชี Google ของมหาวิทยาลัย \(@nu\.ac\.th\)/ });
  await expect(btn).toBeVisible();
  await btn.click();
  await expect.poll(() => googleUrl, { timeout: 15000 }).toContain("accounts.google.com");
  const u = new URL(googleUrl);
  expect(u.searchParams.get("hd")).toBe("nu.ac.th");
  expect(u.searchParams.get("client_id")).toBe("e2e-dummy-client");
});

test("บัญชีที่ถูกฐานข้อมูลปฏิเสธ (นอกโดเมน) เห็นข้อความสำหรับบุคลากรเท่านั้น", async ({ page }) => {
  await page.goto("/auth/callback?error=server_error&error_description=Database+error+saving+new+user");
  await expect(page).toHaveURL(/\/login\?error=domain/);
  await expect(page.getByText(/ระบบนี้สำหรับบุคลากรเท่านั้น — กรุณาใช้บัญชี @nu\.ac\.th/)).toBeVisible();
});

test("ผู้ดูแลลงทะเบียนบุคลากรล่วงหน้าแบบไม่ตั้งรหัสผ่าน และปฏิเสธอีเมลนอกโดเมน", async ({ page }) => {
  await page.goto("/login");
  await page.locator("summary", { hasText: "อีเมลและรหัสผ่าน" }).click();
  await page.getByLabel("อีเมล").fill("admin@demo.example.com");
  await page.getByLabel("รหัสผ่าน").fill(PASS);
  await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.goto("/settings/users");
  const form = page.locator("form", { has: page.getByRole("button", { name: "สร้างบัญชี" }) });
  await form.getByLabel(/อีเมลมหาวิทยาลัย/).fill("someone@gmail.com");
  await form.getByLabel(/ชื่อ-สกุล/).fill("บุคคลภายนอก");
  await form.getByRole("button", { name: "สร้างบัญชี" }).click();
  await expect(page.getByText(/อีเมลต้องเป็นโดเมนของมหาวิทยาลัย/)).toBeVisible();
  const email = `staff.${Date.now()}@nu.ac.th`;
  await form.getByLabel(/อีเมลมหาวิทยาลัย/).fill(email);
  await form.getByLabel(/ชื่อ-สกุล/).fill("บุคลากร ทดสอบ");
  await form.getByRole("button", { name: "สร้างบัญชี" }).click();
  await expect(page.getByText(new RegExp(`ลงทะเบียน ${email.replace(/\./g, "\\.")} แล้ว`))).toBeVisible();
  await page.goto(`/settings/users?q=${email}`);
  await expect(page.getByText(email)).toBeVisible();
});
