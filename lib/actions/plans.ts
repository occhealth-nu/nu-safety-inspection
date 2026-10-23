"use server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { toActionError, type ActionResult } from "@/lib/errors";

const planSchema = z.object({
  name: z.string().trim().min(3, "กรุณาระบุชื่อแผน"),
  organization_id: z.string().uuid("กรุณาเลือกหน่วยงาน"),
  building_id: z.string().uuid().optional().or(z.literal("")),
  asset_type_id: z.string().uuid().optional().or(z.literal("")),
  template_id: z.string().uuid("กรุณาเลือกแบบตรวจ"),
  frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "yearly", "custom"]),
  custom_interval_days: z.coerce.number().int().min(1).max(3650).optional().or(z.literal("")),
  start_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "กรุณาระบุวันเริ่ม"),
  end_on: z.string().optional(),
  due_within_days: z.coerce.number().int().min(1).optional().or(z.literal("")),
  default_inspector_id: z.string().uuid().optional().or(z.literal("")),
});

export async function createPlan(_: unknown, form: FormData): Promise<ActionResult<{ id: string; generated: number }>> {
  const parsed = planSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const v = parsed.data;
  if (v.frequency === "custom" && !v.custom_interval_days) return { ok: false, message: "รอบกำหนดเองต้องระบุจำนวนวัน" };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase.from("inspection_plans").insert({
    name: v.name, organization_id: v.organization_id, building_id: v.building_id || null, asset_type_id: v.asset_type_id || null,
    template_id: v.template_id, frequency: v.frequency, custom_interval_days: v.custom_interval_days || null,
    start_on: v.start_on, end_on: v.end_on || null, due_within_days: v.due_within_days || null,
    default_inspector_id: v.default_inspector_id || null, created_by: user?.id,
  }).select("id").single();
  if (error) return toActionError(error, "บันทึกแผนไม่สำเร็จ");
  const gen = await supabase.rpc("generate_inspection_tasks", { p_plan_id: data.id, p_until: null });
  if (gen.error) return toActionError(gen.error);
  return { ok: true, data: { id: data.id, generated: gen.data as number }, message: `บันทึกแผนแล้ว และสร้างงานตรวจ ${gen.data} งาน` };
}

export async function generateTasks(planId: string): Promise<ActionResult<number>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("generate_inspection_tasks", { p_plan_id: planId, p_until: null });
  if (error) return toActionError(error);
  return { ok: true, data: data as number, message: data ? `สร้างงานตรวจเพิ่ม ${data} งาน` : "งานตรวจครบแล้ว ไม่มีงานใหม่" };
}

export async function togglePlan(planId: string, active: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  const { error, count } = await supabase.from("inspection_plans").update({ is_active: active }, { count: "exact" }).eq("id", planId);
  if (error) return toActionError(error);
  if (!count) return { ok: false, code: "FORBIDDEN", message: "ไม่มีสิทธิ์แก้ไขแผนนี้" };
  return { ok: true, message: active ? "เปิดใช้แผนแล้ว" : "ปิดใช้แผนแล้ว" };
}

export async function assignTasks(_: unknown, form: FormData): Promise<ActionResult> {
  const ids = form.getAll("task_id").map(String).filter(Boolean);
  const assignee = String(form.get("assignee_id") ?? "");
  if (!ids.length) return { ok: false, message: "กรุณาเลือกงานตรวจอย่างน้อย 1 งาน" };
  const supabase = await createClient();
  const { error, count } = await supabase.from("inspection_tasks")
    .update({ assignee_id: assignee || null }, { count: "exact" }).in("id", ids).eq("status", "open");
  if (error) return toActionError(error);
  if (!count) return { ok: false, code: "FORBIDDEN", message: "ไม่มีงานที่คุณมีสิทธิ์มอบหมาย" };
  return { ok: true, message: `มอบหมายแล้ว ${count} งาน${count < ids.length ? ` (ข้าม ${ids.length - count} งานที่ไม่มีสิทธิ์หรือส่งผลแล้ว)` : ""}` };
}

export async function cancelTask(taskId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error, count } = await supabase.from("inspection_tasks").update({ status: "cancelled" }, { count: "exact" }).eq("id", taskId).eq("status", "open");
  if (error) return toActionError(error);
  if (!count) return { ok: false, code: "FORBIDDEN", message: "ยกเลิกไม่ได้ (ไม่มีสิทธิ์ หรือส่งผลแล้ว)" };
  return { ok: true, message: "ยกเลิกงานตรวจแล้ว" };
}
