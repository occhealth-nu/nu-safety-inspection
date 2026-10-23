"use server";
import { createClient } from "@/lib/supabase/server";
import { toActionError, type ActionResult } from "@/lib/errors";

// หน้าจอเรียก router.refresh() เองหลังได้รับผลสำเร็จจาก Backend (ไม่ revalidate ระหว่างสตรีมผลลัพธ์)
function done(_id: string, message: string): ActionResult {
  return { ok: true, message };
}

export async function assignFinding(_: unknown, form: FormData): Promise<ActionResult> {
  const id = String(form.get("finding_id"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_finding", {
    p_finding_id: id, p_assignee_id: String(form.get("assignee_id") || "") || null, p_due_on: String(form.get("due_on") || "") || null,
    p_initial_measure: String(form.get("initial_measure") ?? ""), p_responsible_org_id: null, p_note: String(form.get("note") ?? ""),
  });
  if (error) return toActionError(error);
  return done(id, "มอบหมายงานแก้ไขแล้ว และแจ้งเตือนผู้รับผิดชอบ");
}

export async function startWork(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("start_corrective_work", { p_finding_id: id, p_note: null });
  if (error) return toActionError(error);
  return done(id, "รับงานแล้ว สถานะ: กำลังแก้ไข");
}

export async function addProgress(_: unknown, form: FormData): Promise<ActionResult> {
  const id = String(form.get("finding_id"));
  const pct = form.get("progress_pct") ? Number(form.get("progress_pct")) : null;
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_corrective_progress", { p_finding_id: id, p_note: String(form.get("note") ?? ""), p_progress_pct: pct });
  if (error) return toActionError(error);
  return done(id, "บันทึกความคืบหน้าแล้ว");
}

export async function submitFix(_: unknown, form: FormData): Promise<ActionResult> {
  const id = String(form.get("finding_id"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_corrective_fix", {
    p_finding_id: id, p_note: String(form.get("note") ?? ""), p_no_photo_reason: String(form.get("no_photo_reason") ?? "") || null,
  });
  if (error) return toActionError(error);
  return done(id, "ส่งผลการแก้ไขแล้ว รอผู้ตรวจยืนยัน");
}

export async function verifyFinding(_: unknown, form: FormData): Promise<ActionResult> {
  const id = String(form.get("finding_id"));
  const approve = form.get("decision") === "approve";
  const supabase = await createClient();
  const { error } = await supabase.rpc("verify_finding", { p_finding_id: id, p_approve: approve, p_note: String(form.get("note") ?? "") || null });
  if (error) return toActionError(error);
  return done(id, approve ? "ตรวจยืนยันผ่าน — ปิดงานแล้ว" : "ส่งกลับให้แก้ไขเพิ่มเติมแล้ว");
}

export async function createWorkOrder(_: unknown, form: FormData): Promise<ActionResult<{ id: string; wo_no: string }>> {
  const id = String(form.get("finding_id"));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_work_order", {
    p_finding_id: id, p_target_unit: String(form.get("target_unit") ?? ""), p_description: String(form.get("description") ?? ""),
  });
  if (error) return toActionError(error);
  const wo = data as { id: string; wo_no: string };
  return { ok: true, data: wo, message: `ออกใบงาน ${wo.wo_no} แล้ว (ยังไม่ได้ส่งเข้าระบบภายนอก — พิมพ์/ส่งออกเอกสารเพื่อส่งต่อ)` };
}
