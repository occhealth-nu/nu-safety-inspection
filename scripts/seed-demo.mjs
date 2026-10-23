#!/usr/bin/env node
// สร้างผู้ใช้สาธิต (ข้อมูลตัวอย่าง) ผ่าน Supabase Auth Admin API แล้วสร้างประวัติการตรวจจำลอง
// ใช้: NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... DEMO_PASSWORD=... node scripts/seed-demo.mjs
// ห้ามรันบนระบบจริง — บัญชีสาธิตใช้รหัสผ่านเดียวกันทั้งหมด
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.DEMO_PASSWORD;
if (!url || !key || !password) {
  console.error("ต้องกำหนด NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY และ DEMO_PASSWORD (อย่างน้อย 10 ตัวอักษร)");
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false } });
const users = [
  ["admin", "ผู้ดูแลระบบ (ตัวอย่าง)"], ["coordinator", "ผู้ประสานงานความปลอดภัย (ตัวอย่าง)"],
  ["eng.admin", "ผู้ดูแลคณะวิศวฯ (ตัวอย่าง)"], ["sci.admin", "ผู้ดูแลคณะวิทยาศาสตร์ (ตัวอย่าง)"],
  ["inspector.eng", "ผู้ตรวจ คณะวิศวฯ (ตัวอย่าง)"], ["inspector.sci", "ผู้ตรวจ คณะวิทยาศาสตร์ (ตัวอย่าง)"],
  ["fixer", "ช่างกองอาคารฯ (ตัวอย่าง)"], ["fixer.eng", "ช่างคณะวิศวฯ (ตัวอย่าง)"],
  ["verifier", "ผู้ตรวจยืนยัน (ตัวอย่าง)"], ["executive", "ผู้บริหาร (ตัวอย่าง)"],
];
for (const [u, name] of users) {
  const email = `${u}@demo.example.com`;
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
  console.log(error ? `• ${email}: ${error.message}` : `• สร้าง ${email}`);
}
const { data, error } = await admin.rpc("demo_seed_activity");
if (error) { console.error("demo_seed_activity:", error.message); process.exit(1); }
console.log("ข้อมูลกิจกรรมตัวอย่าง:", data);
