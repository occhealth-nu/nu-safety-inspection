export interface ActionResult<T = unknown> {
  ok: boolean;
  data?: T;
  code?: string;
  message?: string;
  details?: { item_id?: string; seq?: number; message: string }[];
}

interface PgLikeError { message?: string; hint?: string | null; details?: string | null; code?: string }

const SQLSTATE_MESSAGES: Record<string, string> = {
  "42501": "ไม่มีสิทธิ์ดำเนินการนี้",
  "23505": "ข้อมูลซ้ำกับที่มีอยู่แล้ว (เช่น รหัสซ้ำ)",
  "23503": "ข้อมูลอ้างอิงไม่ถูกต้องหรือถูกใช้งานอยู่",
  "23514": "ข้อมูลไม่ผ่านเงื่อนไขที่กำหนด",
  "22P02": "รูปแบบข้อมูลไม่ถูกต้อง",
  PGRST116: "ไม่พบข้อมูล หรือไม่มีสิทธิ์เข้าถึง",
};

/** แปลงข้อผิดพลาดจาก Supabase/PostgREST เป็นข้อความไทยที่ผู้ใช้เข้าใจได้ */
export function toActionError(error: PgLikeError | null | undefined, fallback = "เกิดข้อผิดพลาด กรุณาลองใหม่"): ActionResult<never> {
  if (!error) return { ok: false, message: fallback };
  const code = error.hint || error.code || "UNKNOWN";
  let details: ActionResult["details"];
  if (error.details && error.details.startsWith("[")) {
    try { details = JSON.parse(error.details); } catch { /* ignore */ }
  }
  // ข้อความจากฟังก์ชันในฐานข้อมูล (มี hint) เป็นภาษาไทยอยู่แล้ว
  const message = error.hint ? error.message : SQLSTATE_MESSAGES[error.code ?? ""] ?? fallback;
  if (!error.hint) console.error("[db-error]", error.code, error.message);
  return { ok: false, code, message, details };
}

export function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError && /fetch|network/i.test(String(e.message));
}

/** ฐานข้อมูลยังไม่มีฟังก์ชัน/คอลัมน์ที่โค้ดเวอร์ชันนี้ต้องใช้ (ยังไม่ได้รันไฟล์อัปเกรด หรือ API ยังไม่โหลดรายการใหม่) */
export function isSchemaOutdated(error: PgLikeError | null | undefined): boolean {
  if (!error) return false;
  return ["PGRST202", "PGRST204", "PGRST200", "42883", "42703", "42P01"].includes(error.code ?? "")
    || /could not find the (function|.*column)|does not exist|schema cache/i.test(error.message ?? "");
}

export const SCHEMA_UPGRADE_HINT =
  "ฐานข้อมูลยังไม่ได้อัปเกรดให้ตรงกับระบบเวอร์ชันนี้ — ผู้ดูแลระบบเปิด Supabase › SQL Editor แล้วรันไฟล์ " +
  "05_upgrade_building_locations.sql (ทั้งไฟล์) จากนั้นรีเฟรชหน้านี้ ถ้ารันแล้วยังขึ้นข้อความนี้ ให้รันคำสั่ง notify pgrst, 'reload schema'; แล้วรอ 1 นาที";
