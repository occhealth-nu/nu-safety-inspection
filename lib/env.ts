// ค่าตั้งระบบที่อ่านจาก environment (ไม่มีค่าลับฝังในโค้ด)
// จัดรูปแบบค่าที่คัดลอก–วางมาให้อัตโนมัติ: ตัดช่องว่าง/ขึ้นบรรทัดใหม่, เครื่องหมายคำพูด, /rest/v1 และ / ท้าย URL

/** ตัดช่องว่าง บรรทัดใหม่ และเครื่องหมายคำพูดที่มักติดมาตอนคัดลอก */
export function cleanValue(v: string | undefined | null): string {
  return (v ?? "").replace(/[\s​﻿]+/g, "").replace(/^["'“”‘’]+|["'“”‘’]+$/g, "");
}

/** แปลงค่า Supabase URL ให้อยู่ในรูป https://xxxx.supabase.co */
export function normalizeSupabaseUrl(v: string | undefined | null): string {
  let u = cleanValue(v);
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  u = u.replace(/\/(rest|auth|storage)\/v1\/?.*$/i, "").replace(/\/+$/, "");
  return u;
}

export function isValidHttpUrl(v: string): boolean {
  try { const u = new URL(v); return u.protocol === "https:" || u.protocol === "http:"; } catch { return false; }
}

export const env = {
  supabaseUrl: normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: cleanValue(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  appUrl: (cleanValue(process.env.NEXT_PUBLIC_APP_URL) || "http://localhost:3000").replace(/\/+$/, ""),
  ssoProvider: cleanValue(process.env.NEXT_PUBLIC_SSO_PROVIDER).toLowerCase(),
  // google = เข้าสู่ระบบด้วยบัญชี Google Workspace ของมหาวิทยาลัย; azure / saml = ทางเลือกอื่น
  ssoDomain: cleanValue(process.env.NEXT_PUBLIC_SSO_DOMAIN) || (cleanValue(process.env.NEXT_PUBLIC_SSO_PROVIDER).toLowerCase() === "google" ? "nu.ac.th" : ""),
};

/** ปัญหาการตั้งค่าที่ตรวจพบ (ข้อความภาษาไทย ไม่มีค่าลับ) */
export function configProblems(): string[] {
  const p: string[] = [];
  if (!env.supabaseUrl) p.push("ยังไม่ได้ตั้ง NEXT_PUBLIC_SUPABASE_URL");
  else if (!isValidHttpUrl(env.supabaseUrl)) p.push("NEXT_PUBLIC_SUPABASE_URL ไม่ใช่ที่อยู่เว็บที่ถูกต้อง (ควรเป็น https://xxxx.supabase.co)");
  if (!env.supabaseAnonKey) p.push("ยังไม่ได้ตั้ง NEXT_PUBLIC_SUPABASE_ANON_KEY");
  else if (!/^(eyJ[\w-]+\.[\w-]+\.[\w-]+|sb_publishable_[\w-]+)$/.test(env.supabaseAnonKey))
    p.push("NEXT_PUBLIC_SUPABASE_ANON_KEY รูปแบบไม่ถูกต้อง (ต้องขึ้นต้นด้วย eyJ… หรือ sb_publishable_…) — อาจคัดลอกไม่ครบหรือใช้ key ผิดตัว");
  if (env.supabaseAnonKey.startsWith("sb_secret_")) p.push("ใส่ Secret key ในช่อง NEXT_PUBLIC_SUPABASE_ANON_KEY — ต้องใช้ anon/Publishable key (และควรสร้าง Secret key ใหม่ทันที)");
  return p;
}

export function assertSupabaseEnv() {
  const p = configProblems();
  if (p.length) throw new Error("การตั้งค่าระบบไม่ถูกต้อง: " + p.join("; "));
}
