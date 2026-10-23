"use server";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/errors";

export async function changePassword(_: unknown, form: FormData): Promise<ActionResult> {
  const current = String(form.get("current_password") ?? "");
  const next = String(form.get("new_password") ?? "");
  const confirm = String(form.get("confirm_password") ?? "");
  if (next.length < 10) return { ok: false, message: "รหัสผ่านใหม่ต้องมีอย่างน้อย 10 ตัวอักษร" };
  if (next !== confirm) return { ok: false, message: "ยืนยันรหัสผ่านใหม่ไม่ตรงกัน" };
  if (next === current) return { ok: false, message: "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม" };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, code: "UNAUTHENTICATED", message: "กรุณาเข้าสู่ระบบใหม่" };
  // ยืนยันรหัสผ่านเดิมก่อนเปลี่ยน
  const check = await supabase.auth.signInWithPassword({ email: user.email, password: current });
  if (check.error) return { ok: false, message: "รหัสผ่านเดิมไม่ถูกต้อง" };
  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) return { ok: false, message: "เปลี่ยนรหัสผ่านไม่สำเร็จ: " + error.message };
  return { ok: true, message: "เปลี่ยนรหัสผ่านเรียบร้อยแล้ว" };
}
