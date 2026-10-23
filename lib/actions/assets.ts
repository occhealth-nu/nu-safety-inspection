"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { toActionError, type ActionResult } from "@/lib/errors";

const opt = (s: z.ZodTypeAny) => s.optional().or(z.literal("")).transform((v) => (v === "" ? null : v ?? null));
const schema = z.object({
  code: z.string().trim().min(2, "กรุณาระบุรหัส").max(40).regex(/^[A-Za-z0-9._-]+$/, "รหัสใช้ได้เฉพาะ A-Z 0-9 . _ -"),
  name: z.string().trim().min(2, "กรุณาระบุชื่อ").max(200),
  asset_type_id: z.string().uuid("กรุณาเลือกประเภท"),
  organization_id: z.string().uuid("กรุณาเลือกหน่วยงาน"),
  building_id: z.string().uuid("กรุณาเลือกอาคาร"),
  floor_id: opt(z.string().uuid()),
  location_id: opt(z.string().uuid()),
  location_detail: opt(z.string().max(300)),
  responsible_user_id: opt(z.string().uuid()),
  brand_model: opt(z.string().max(200)),
  serial_no: opt(z.string().max(100)),
  installed_on: opt(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  expires_on: opt(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "yearly", "custom"]),
  custom_interval_days: opt(z.coerce.number().int().min(1).max(3650)),
  status: z.enum(["active", "inactive", "relocated", "disposed"]).default("active"),
  notes: opt(z.string().max(2000)),
});

export async function saveAsset(_: unknown, form: FormData): Promise<ActionResult<{ id: string }>> {
  const id = String(form.get("id") ?? "");
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  let res;
  if (id) {
    res = await supabase.from("assets").update(parsed.data).eq("id", id).select("id").maybeSingle();
    if (!res.error && !res.data) return { ok: false, code: "FORBIDDEN", message: "ไม่มีสิทธิ์แก้ไขจุดตรวจนี้" };
  } else {
    res = await supabase.from("assets").insert({ ...parsed.data, created_by: user?.id }).select("id").single();
  }
  if (res.error) return toActionError(res.error, "บันทึกไม่สำเร็จ");
  redirect(`/assets/${res.data!.id}?saved=1`);
}
