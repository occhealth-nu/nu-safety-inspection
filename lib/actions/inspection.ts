"use server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { toActionError, type ActionResult } from "@/lib/errors";

const responseSchema = z.array(z.object({
  item_id: z.guid(),
  result: z.enum(["pass", "fail", "na"]).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  na_reason: z.string().max(500).nullable().optional(),
  urgency: z.enum(["low", "medium", "high", "critical"]).nullable().optional(),
  photo_exempt_reason: z.string().max(500).nullable().optional(),
})).max(300);

export type ResponseInput = z.infer<typeof responseSchema>[number];

export async function saveInspectionDraft(inspectionId: string, responses: ResponseInput[], summary: string): Promise<ActionResult<{ saved_at: string }>> {
  const parsed = responseSchema.safeParse(responses);
  if (!parsed.success) return { ok: false, message: "ข้อมูลไม่ถูกต้อง" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_inspection_draft", { p_inspection_id: inspectionId, p_responses: parsed.data, p_summary: summary || null });
  if (error) return toActionError(error, "บันทึกฉบับร่างไม่สำเร็จ");
  return { ok: true, data: { saved_at: (data as { saved_at: string }).saved_at }, message: "บันทึกฉบับร่างในระบบแล้ว" };
}

export interface GeoInput { lat: number | null; lng: number | null; accuracy: number | null; status?: "denied" | "unavailable" }
const geoSchema = z.object({
  lat: z.number().min(-90).max(90).nullable(), lng: z.number().min(-180).max(180).nullable(),
  accuracy: z.number().min(0).max(100000).nullable(), status: z.enum(["denied", "unavailable"]).optional(),
}).nullable().optional();

export async function submitInspection(inspectionId: string, responses: ResponseInput[], summary: string, clientSubmissionId: string, geo?: GeoInput | null)
  : Promise<ActionResult<{ inspection_id: string; already_submitted: boolean; findings: { id: string; finding_no: string }[]; score_pct: number | null }>> {
  const parsed = responseSchema.safeParse(responses);
  if (!parsed.success || !z.guid().safeParse(clientSubmissionId).success) return { ok: false, message: "ข้อมูลไม่ถูกต้อง" };
  const g = geoSchema.safeParse(geo);
  const supabase = await createClient();
  // พิกัดผู้ตรวจขณะส่งผล (ยืนยันการตรวจหน้างาน) — ไม่บังคับ บันทึกไม่ได้ก็ยังส่งผลตรวจได้
  if (g.success && g.data) {
    await supabase.rpc("record_inspection_location", {
      p_inspection_id: inspectionId, p_lat: g.data.lat, p_lng: g.data.lng, p_accuracy: g.data.accuracy, p_status: g.data.status ?? null,
    });
  }
  const { data, error } = await supabase.rpc("submit_inspection", {
    p_inspection_id: inspectionId, p_responses: parsed.data, p_summary: summary || null, p_client_submission_id: clientSubmissionId,
  });
  if (error) return toActionError(error, "ส่งผลตรวจไม่สำเร็จ");
  return { ok: true, data: data as never, message: "ส่งผลตรวจเรียบร้อยแล้ว" };
}
