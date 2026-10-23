"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { toActionError, type ActionResult } from "@/lib/errors";

const t = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");

export async function createTemplate(_: unknown, form: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase.from("checklist_templates").insert({
    code: t(form.get("code")).toUpperCase(), name: t(form.get("name")), category: t(form.get("category")),
    description: t(form.get("description")) || null, organization_id: t(form.get("organization_id")) || null, created_by: user?.id,
  }).select("id").single();
  if (error) return toActionError(error, "สร้างแบบตรวจไม่สำเร็จ");
  const v = await supabase.rpc("create_checklist_version", { p_template_id: data.id, p_change_note: "เวอร์ชันแรก" });
  if (v.error) return toActionError(v.error);
  redirect(`/settings/checklists/${data.id}`);
}

export async function newVersion(templateId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_checklist_version", { p_template_id: templateId, p_change_note: null });
  if (error) return toActionError(error);
  return { ok: true, message: "สร้างเวอร์ชันร่างใหม่แล้ว (คัดลอกรายการจากเวอร์ชันล่าสุด)" };
}

export async function publishVersion(templateId: string, versionId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("publish_checklist_version", { p_version_id: versionId });
  if (error) return toActionError(error);
  return { ok: true, message: "เผยแพร่แล้ว — การตรวจใหม่จะใช้เวอร์ชันนี้ ประวัติเดิมยังแสดงเกณฑ์ของเวอร์ชันที่ใช้ในวันตรวจ" };
}

export async function saveItem(_: unknown, form: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const id = t(form.get("id"));
  const values = {
    version_id: t(form.get("version_id")), seq: Number(form.get("seq")), section: t(form.get("section")) || null, title: t(form.get("title")),
    description: t(form.get("description")) || null, method: t(form.get("method")) || null, severity: t(form.get("severity")) || "medium",
    allow_na: form.get("allow_na") === "on", photo_required_on_fail: form.get("photo_required_on_fail") === "on",
  };
  if (!values.title) return { ok: false, message: "กรุณาระบุหัวข้อการตรวจ" };
  const res = id ? await supabase.from("checklist_items").update(values).eq("id", id).select("id") : await supabase.from("checklist_items").insert(values).select("id");
  if (res.error) return toActionError(res.error);
  if (!res.data?.length) return { ok: false, message: "ไม่มีสิทธิ์แก้ไขแบบตรวจนี้" };
  return { ok: true, message: "บันทึกรายการตรวจแล้ว" };
}

export async function deleteItem(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error, count } = await supabase.from("checklist_items").delete({ count: "exact" }).eq("id", id);
  if (error) return toActionError(error);
  if (!count) return { ok: false, message: "ลบไม่ได้" };
  return { ok: true, message: "ลบแล้ว" };
}

export async function saveVersionMeta(_: unknown, form: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const sources = form.getAll("ref_source").map(String); const editions = form.getAll("ref_edition").map(String); const dates = form.getAll("ref_checked_on").map(String);
  const refs = sources.map((src, i) => ({ source: src.trim(), edition: (editions[i] ?? "").trim(), checked_on: dates[i] ?? "" })).filter((r) => r.source || r.edition || r.checked_on);
  const isDraft = form.get("is_expert_review_draft") === "on";
  const { data, error } = await supabase.from("checklist_versions").update({
    legal_references: refs, is_expert_review_draft: isDraft, approved_by_expert: t(form.get("approved_by_expert")) || null, change_note: t(form.get("change_note")) || null,
  }).eq("id", t(form.get("version_id"))).select("id");
  if (error) {
    if (error.code === "23514") return { ok: false, message: "การยกเลิกสถานะ “ร่าง” ต้องระบุผู้เชี่ยวชาญที่รับรอง และแหล่งอ้างอิงครบทุกช่อง (แหล่ง ฉบับ วันที่ตรวจสอบ)" };
    return toActionError(error);
  }
  if (!data?.length) return { ok: false, message: "ไม่มีสิทธิ์แก้ไข หรือเวอร์ชันนี้เผยแพร่แล้ว" };
  return { ok: true, message: "บันทึกข้อมูลเวอร์ชันแล้ว" };
}
