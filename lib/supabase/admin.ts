import "server-only";
import { createClient } from "@supabase/supabase-js";
import { cleanValue, env } from "@/lib/env";

/**
 * Service-role client — ข้าม RLS ใช้เฉพาะงานที่จำเป็น:
 * สร้างบัญชีผู้ใช้ (หลังตรวจว่าผู้เรียกเป็นผู้ดูแลแล้ว) และงานแจ้งเตือนตามเวลา
 * ห้ามใช้อ่าน/เขียนข้อมูลแทนผู้ใช้ทั่วไป
 */
export function createAdminClient() {
  const key = cleanValue(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!env.supabaseUrl || !key) throw new Error("ยังไม่ได้ตั้งค่า SUPABASE_SERVICE_ROLE_KEY");
  return createClient(env.supabaseUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
