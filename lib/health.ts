import "server-only";
import { cleanValue, configProblems, env, isValidHttpUrl } from "@/lib/env";

export interface Check { name: string; ok: boolean | null; detail: string }

async function fetchJson(url: string, key: string, ms = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: ctrl.signal, cache: "no-store" });
    let body: unknown = null;
    try { body = await r.json(); } catch { /* not json */ }
    return { status: r.status, body };
  } finally { clearTimeout(t); }
}

function projectRef(url: string) { const m = /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url); return m?.[1] ?? ""; }

/** ตรวจการตั้งค่าระบบ — ไม่แสดงค่าลับใด ๆ */
export async function runHealthChecks(requestHost?: string): Promise<Check[]> {
  const checks: Check[] = [];
  const problems = configProblems();
  checks.push({ name: "NEXT_PUBLIC_SUPABASE_URL", ok: !!env.supabaseUrl && isValidHttpUrl(env.supabaseUrl),
    detail: env.supabaseUrl ? `ใช้ค่า ${env.supabaseUrl}${projectRef(env.supabaseUrl) ? ` — รหัสโปรเจกต์ (Project Ref) ${projectRef(env.supabaseUrl)} ต้องตรงกับลิงก์ supabase.com/dashboard/project/${projectRef(env.supabaseUrl)} ที่ใช้รันไฟล์ SQL` : ""}` : "ยังไม่ได้ตั้งค่า" });
  checks.push({ name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", ok: !problems.some((p) => p.includes("ANON_KEY")),
    detail: problems.find((p) => p.includes("ANON_KEY")) ?? `รูปแบบถูกต้อง (${env.supabaseAnonKey.startsWith("sb_") ? "Publishable key" : "anon key"})` });
  const service = cleanValue(process.env.SUPABASE_SERVICE_ROLE_KEY);
  checks.push({ name: "SUPABASE_SERVICE_ROLE_KEY", ok: /^(eyJ[\w-]+\.[\w-]+\.[\w-]+|sb_secret_[\w-]+)$/.test(service),
    detail: !service ? "ยังไม่ได้ตั้งค่า (จำเป็นสำหรับเพิ่มผู้ใช้และงานแจ้งเตือน)" : service.startsWith("sb_publishable_") ? "ใส่ Publishable key ผิดช่อง — ต้องใช้ service_role หรือ Secret key" : /^(eyJ|sb_secret_)/.test(service) ? "ตั้งค่าแล้ว" : "รูปแบบไม่ถูกต้อง" });
  const cron = process.env.CRON_SECRET ?? "";
  checks.push({ name: "CRON_SECRET", ok: /^[A-Za-z0-9]{24,128}$/.test(cron),
    detail: !cron ? "ยังไม่ได้ตั้งค่า" : /^[A-Za-z0-9]{24,128}$/.test(cron) ? "ตั้งค่าแล้ว" : "ควรใช้เฉพาะ a–z A–Z 0–9 ยาว 24 ตัวขึ้นไป" });
  const appHost = (() => { try { return cleanValue(process.env.NEXT_PUBLIC_APP_URL) ? new URL(env.appUrl).host : ""; } catch { return ""; } })();
  checks.push({ name: "NEXT_PUBLIC_APP_URL", ok: !appHost ? null : !requestHost || appHost === requestHost,
    detail: !appHost ? `ไม่ได้ตั้ง — ใช้โดเมนที่เปิดอยู่${requestHost ? ` (https://${requestHost})` : ""} สำหรับ QR Code` : requestHost && appHost !== requestHost
      ? `ตั้งไว้ ${env.appUrl} แต่เว็บนี้เปิดที่ https://${requestHost} — ถ้าเป็นที่อยู่ถาวร ให้แก้ค่า (หรือลบตัวแปรนี้ทิ้ง) แล้ว Redeploy (ใช้พิมพ์ QR Code)` : `ใช้ค่า ${env.appUrl}` });
  checks.push({ name: "NEXT_PUBLIC_SSO_PROVIDER", ok: env.ssoProvider ? ["google", "azure", "saml"].includes(env.ssoProvider) : null,
    detail: env.ssoProvider ? `${env.ssoProvider}${env.ssoProvider === "google" ? ` (โดเมน ${env.ssoDomain})` : ""}` : "ไม่ได้ตั้ง — ใช้อีเมล/รหัสผ่านอย่างเดียว" });

  if (problems.length === 0) {
    try {
      const auth = await fetchJson(`${env.supabaseUrl}/auth/v1/settings`, env.supabaseAnonKey);
      const s = auth.body as { external?: Record<string, boolean>; disable_signup?: boolean } | null;
      checks.push({ name: "เชื่อมต่อ Supabase Auth", ok: auth.status === 200,
        detail: auth.status === 200 ? "เชื่อมต่อได้" : auth.status === 401 ? "key ไม่ถูกต้องสำหรับโปรเจกต์นี้ (ตรวจว่า URL และ anon key มาจากโปรเจกต์เดียวกัน)" : `ตอบกลับสถานะ ${auth.status}` });
      if (auth.status === 200 && env.ssoProvider === "google") {
        checks.push({ name: "Google provider ใน Supabase", ok: !!s?.external?.google,
          detail: s?.external?.google ? "เปิดใช้แล้ว" : "ยังไม่ได้เปิด — Supabase › Authentication › Sign In / Providers › Google" });
      }
      const db = await fetchJson(`${env.supabaseUrl}/rest/v1/app_settings?select=id,allowed_email_domains`, env.supabaseAnonKey);
      checks.push({ name: "ติดตั้งฐานข้อมูล (ไฟล์ 01–02)", ok: db.status === 200 && Array.isArray(db.body) && db.body.length === 1,
        detail: db.status === 200 ? (Array.isArray(db.body) && db.body.length ? `ติดตั้งแล้ว (โดเมนที่อนุญาต: ${(db.body[0] as { allowed_email_domains?: string[] }).allowed_email_domains?.join(", ") ?? "-"})` : "พบตารางแต่ไม่มีข้อมูลตั้งต้น — รันไฟล์ 01 ใหม่")
          : db.status === 404 ? "ยังไม่ได้ติดตั้ง — รัน deploy/01_install_database.sql และ 02 ใน Supabase SQL Editor" : `ตอบกลับสถานะ ${db.status}` });
      // ข้อมูลในโปรเจกต์ Supabase ที่เว็บนี้เชื่อมอยู่ — ใช้เทียบกับโปรเจกต์ที่รันไฟล์ SQL
      const st = await fetchJson(`${env.supabaseUrl}/rest/v1/rpc/system_status`, env.supabaseAnonKey);
      const v = st.body as { schema_building_locations?: boolean; schema_building_details?: boolean; organizations?: number;
        buildings?: number; assets?: number; users?: number; demo_data?: boolean } | null;
      if (st.status === 200 && v) {
        checks.push({ name: "อัปเกรดฐานข้อมูล (ไฟล์ 05)", ok: !!v.schema_building_locations,
          detail: v.schema_building_locations ? "อัปเกรดแล้ว" : "ยังไม่ได้รัน 05_upgrade_building_locations.sql ในโปรเจกต์นี้" });
        checks.push({ name: "ข้อมูลหน่วยงาน/อาคาร (ไฟล์ 06–07)", ok: !!v.schema_building_details && (v.buildings ?? 0) >= 204,
          detail: `หน่วยงาน ${v.organizations} · อาคาร ${v.buildings} · จุดตรวจ ${v.assets} · ผู้ใช้ ${v.users}` +
            ((v.buildings ?? 0) >= 204 ? "" : " — ยังไม่ครบ 204 อาคาร: รันไฟล์ 06 และ 07 ในโปรเจกต์นี้") });
        checks.push({ name: "ไม่มีข้อมูลตัวอย่าง (ไฟล์ 08)", ok: !v.demo_data,
          detail: v.demo_data ? "ยังมีข้อมูล/บัญชีตัวอย่าง — รัน 08_remove_demo_data.sql" : "ไม่มีข้อมูลตัวอย่าง" });
      } else {
        checks.push({ name: "ข้อมูลหน่วยงาน/อาคาร (ไฟล์ 05–08)", ok: false,
          detail: "โปรเจกต์ Supabase นี้ยังไม่ได้รันไฟล์ 06_import_nu_data.sql — ถ้ารันไปแล้ว แปลว่ารันในโปรเจกต์อื่น (ดูรหัสโปรเจกต์ด้านบน)" });
      }
    } catch (e) {
      checks.push({ name: "เชื่อมต่อ Supabase", ok: false, detail: `เชื่อมต่อไม่ได้: ${(e as Error).name === "AbortError" ? "หมดเวลา (Supabase อาจมีปัญหาชั่วคราว)" : (e as Error).message}` });
    }
  }
  return checks;
}
