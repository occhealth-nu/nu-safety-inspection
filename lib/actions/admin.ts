"use server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { toActionError, type ActionResult } from "@/lib/errors";
import type { AppRole } from "@/lib/types";

const s = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");

// ---------- องค์กร ----------
export async function createOrganization(_: unknown, form: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("organizations").insert({
    parent_id: s(form.get("parent_id")) || null, code: s(form.get("code")).toUpperCase(), name_th: s(form.get("name_th")),
    name_en: s(form.get("name_en")) || null, org_type: s(form.get("org_type")) || "faculty",
  });
  if (error) return toActionError(error, "เพิ่มหน่วยงานไม่สำเร็จ (ต้องเป็นผู้ดูแลระบบมหาวิทยาลัย)");
  return { ok: true, message: "เพิ่มหน่วยงานแล้ว" };
}

export async function toggleOrganization(id: string, active: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  const { error, count } = await supabase.from("organizations").update({ is_active: active }, { count: "exact" }).eq("id", id);
  if (error) return toActionError(error);
  if (!count) return { ok: false, message: "ไม่มีสิทธิ์แก้ไข" };
  return { ok: true, message: "บันทึกแล้ว" };
}

// ---------- อาคาร / ชั้น / ห้อง ----------
export async function createBuilding(_: unknown, form: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("buildings").insert({
    organization_id: s(form.get("organization_id")), code: s(form.get("code")).toUpperCase(), name: s(form.get("name")), description: s(form.get("description")) || null,
  }).select("id").single();
  if (error) return toActionError(error, "เพิ่มอาคารไม่สำเร็จ");
  const floors = Number(form.get("floors") || 0);
  if (floors > 0 && floors <= 60) {
    await supabase.from("floors").insert(Array.from({ length: floors }).map((_, i) => ({ building_id: data.id, name: `ชั้น ${i + 1}`, level: i + 1 })));
  }
  return { ok: true, message: "เพิ่มอาคารแล้ว" };
}

export async function createFloor(_: unknown, form: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("floors").insert({ building_id: s(form.get("building_id")), name: s(form.get("name")), level: Number(form.get("level") || 1) });
  if (error) return toActionError(error, "เพิ่มชั้นไม่สำเร็จ");
  return { ok: true, message: "เพิ่มชั้นแล้ว" };
}

export async function createLocation(_: unknown, form: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("locations").insert({
    floor_id: s(form.get("floor_id")), name: s(form.get("name")), room_no: s(form.get("room_no")) || null, location_type: s(form.get("location_type")) || null,
  });
  if (error) return toActionError(error, "เพิ่มห้อง/พื้นที่ไม่สำเร็จ");
  return { ok: true, message: "เพิ่มห้อง/พื้นที่แล้ว" };
}

// ---------- ผู้ใช้และสิทธิ์ ----------
const newUserSchema = z.object({
  email: z.string().trim().email("อีเมลไม่ถูกต้อง"),
  full_name: z.string().trim().min(2, "กรุณาระบุชื่อ-สกุล"),
  position: z.string().trim().optional(),
  organization_id: z.string().uuid("กรุณาเลือกหน่วยงาน"),
  role: z.enum(["system_admin", "safety_coordinator", "org_admin", "inspector", "responsible", "verifier", "executive"]),
  // เว้นว่าง = ไม่ตั้งรหัสผ่าน ผู้ใช้เข้าสู่ระบบด้วยบัญชี Google ของมหาวิทยาลัยเท่านั้น
  password: z.string().optional().transform((p) => (p ? p : undefined))
    .refine((p) => p === undefined || p.length >= 10, "รหัสผ่านชั่วคราวต้องมีอย่างน้อย 10 ตัวอักษร"),
});

/**
 * สร้างบัญชีผู้ใช้: ตรวจสิทธิ์ผู้เรียกที่ฐานข้อมูลก่อน (i_can_manage_org) แล้วจึงใช้ service role
 * เฉพาะการสร้างบัญชี Auth — การกำหนดหน่วยงานและบทบาททำในนามผู้เรียก (RPC ตรวจสิทธิ์ซ้ำ)
 */
export async function createUser(_: unknown, form: FormData): Promise<ActionResult> {
  const parsed = newUserSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const v = parsed.data;
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("i_can_manage_org", { p_org: v.organization_id });
  if (!allowed) return { ok: false, code: "FORBIDDEN", message: "ไม่มีสิทธิ์เพิ่มผู้ใช้ในหน่วยงานนี้" };
  const { data: domainOk } = await supabase.rpc("email_domain_allowed", { p_email: v.email });
  if (!domainOk) return { ok: false, code: "DOMAIN_NOT_ALLOWED", message: "อีเมลต้องเป็นโดเมนของมหาวิทยาลัย (ตั้งค่าโดเมนที่อนุญาตได้ที่ ตั้งค่าระบบ › ภาพลักษณ์และการเข้าสู่ระบบ)" };
  let admin;
  try { admin = createAdminClient(); } catch { return { ok: false, message: "ยังไม่ได้ตั้งค่า SUPABASE_SERVICE_ROLE_KEY บนเซิร์ฟเวอร์" }; }
  const { data, error } = await admin.auth.admin.createUser({
    email: v.email, ...(v.password ? { password: v.password } : {}), email_confirm: true, user_metadata: { full_name: v.full_name },
  });
  if (error || !data.user) return { ok: false, message: error?.message?.includes("already") ? "อีเมลนี้มีบัญชีอยู่แล้ว" : "สร้างบัญชีไม่สำเร็จ" };
  const claim = await supabase.rpc("claim_new_profile", { p_user: data.user.id, p_organization_id: v.organization_id, p_full_name: v.full_name, p_position: v.position || null });
  if (claim.error) return toActionError(claim.error);
  const grant = await supabase.rpc("grant_role", { p_user: data.user.id, p_role: v.role, p_org: v.organization_id });
  if (grant.error) return { ...toActionError(grant.error), message: `สร้างบัญชีแล้ว แต่กำหนดบทบาทไม่สำเร็จ: ${grant.error.message}` };
  return { ok: true, message: v.password
    ? `สร้างบัญชี ${v.email} แล้ว — แจ้งรหัสผ่านชั่วคราวให้ผู้ใช้ผ่านช่องทางที่ปลอดภัย และให้เปลี่ยนรหัสผ่านที่ “บัญชีของฉัน”`
    : `ลงทะเบียน ${v.email} แล้ว — ผู้ใช้กด “เข้าสู่ระบบด้วยบัญชี Google ของมหาวิทยาลัย” ได้ทันทีพร้อมสิทธิ์ที่กำหนด` };
}

export async function grantRole(_: unknown, form: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  // ผู้ใช้ที่เข้าด้วย Google ครั้งแรกยังไม่มีหน่วยงาน → ตั้งหน่วยงานตามบทบาทแรกที่ได้รับ
  const { data: prof } = await supabase.from("profiles").select("organization_id").eq("id", s(form.get("user_id"))).maybeSingle();
  if (prof && !prof.organization_id) {
    const set = await supabase.rpc("set_profile_admin", { p_user: s(form.get("user_id")), p_organization_id: s(form.get("organization_id")), p_is_active: true, p_full_name: null, p_position: null });
    if (set.error) return toActionError(set.error);
  }
  const { error } = await supabase.rpc("grant_role", { p_user: s(form.get("user_id")), p_role: s(form.get("role")) as AppRole, p_org: s(form.get("organization_id")) });
  if (error) return toActionError(error);
  return { ok: true, message: "เพิ่มบทบาทแล้ว" };
}

export async function revokeRole(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_role", { p_assignment_id: id });
  if (error) return toActionError(error);
  return { ok: true, message: "ถอนบทบาทแล้ว" };
}

export async function setUserActive(userId: string, orgId: string, active: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_profile_admin", { p_user: userId, p_organization_id: orgId, p_is_active: active, p_full_name: null, p_position: null });
  if (error) return toActionError(error);
  return { ok: true, message: active ? "เปิดใช้งานบัญชีแล้ว" : "ระงับบัญชีแล้ว" };
}

// ---------- การแจ้งเตือน ----------
export async function saveNotificationSettings(_: unknown, form: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const id = s(form.get("id"));
  const values = {
    due_soon_days: Number(form.get("due_soon_days")), escalate_after_days: Number(form.get("escalate_after_days")),
    escalation_roles: form.getAll("escalation_roles").map(String), email_enabled: form.get("email_enabled") === "on",
    notify_on_assignment: form.get("notify_on_assignment") === "on", notify_on_urgent: form.get("notify_on_urgent") === "on",
    notify_on_verification: form.get("notify_on_verification") === "on", updated_at: new Date().toISOString(),
  };
  const org = s(form.get("organization_id")) || null;
  const res = id ? await supabase.from("notification_settings").update(values).eq("id", id).select("id")
    : await supabase.from("notification_settings").insert({ ...values, organization_id: org }).select("id");
  if (res.error) return toActionError(res.error);
  if (!res.data?.length) return { ok: false, message: "ไม่มีสิทธิ์แก้ไขการตั้งค่านี้" };
  return { ok: true, message: "บันทึกการตั้งค่าการแจ้งเตือนแล้ว" };
}

// ---------- ภาพลักษณ์ ----------
export async function saveBranding(_: unknown, form: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const hex = /^#[0-9A-Fa-f]{6}$/;
  const primary = s(form.get("primary_color")); const dark = s(form.get("dark_color"));
  if (!hex.test(primary) || !hex.test(dark)) return { ok: false, message: "รหัสสีต้องอยู่ในรูปแบบ #RRGGBB" };
  let logo_url: string | null | undefined = undefined;
  const file = form.get("logo");
  if (file instanceof File && file.size > 0) {
    if (!["image/png", "image/svg+xml", "image/webp", "image/jpeg"].includes(file.type) || file.size > 2 * 1024 * 1024) return { ok: false, message: "ไฟล์ตราต้องเป็น PNG/SVG/WebP/JPG ไม่เกิน 2 MB" };
    const path = `logo-${Date.now()}.${file.type === "image/svg+xml" ? "svg" : file.type.split("/")[1]}`;
    const up = await supabase.storage.from("branding").upload(path, file, { contentType: file.type });
    if (up.error) return { ok: false, message: "อัปโหลดตราไม่สำเร็จ (ต้องเป็นผู้ดูแลระบบ)" };
    logo_url = supabase.storage.from("branding").getPublicUrl(path).data.publicUrl;
  }
  if (form.get("remove_logo") === "on") logo_url = null;
  const domains = s(form.get("allowed_email_domains")).split(/[\s,]+/).map((d) => d.replace(/^@/, "").toLowerCase()).filter(Boolean);
  if (!domains.length || domains.some((d) => !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d))) return { ok: false, message: "โดเมนอีเมลที่อนุญาตไม่ถูกต้อง (เช่น nu.ac.th)" };
  const { data, error } = await supabase.from("app_settings").update({
    app_name: s(form.get("app_name")) || "NU Safety Inspection", university_name_th: s(form.get("university_name_th")),
    university_name_en: s(form.get("university_name_en")), primary_color: primary, dark_color: dark, allowed_email_domains: domains,
    ...(logo_url !== undefined ? { logo_url } : {}), updated_at: new Date().toISOString(),
  }).eq("id", 1).select("id");
  if (error) return toActionError(error);
  if (!data?.length) return { ok: false, message: "ไม่มีสิทธิ์แก้ไข (เฉพาะผู้ดูแลระบบมหาวิทยาลัย)" };
  return { ok: true, message: "บันทึกแล้ว" };
}
