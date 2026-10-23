"use server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { toActionError, type ActionResult } from "@/lib/errors";

const responseSchema = z.array(z.object({
  item_id: z.string().uuid(),
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

export async function submitInspection(inspectionId: string, responses: ResponseInput[], summary: string, clientSubmissionId: string)
  : Promise<ActionResult<{ inspection_id: string; already_submitted: boolean; findings: { id: string; finding_no: string }[]; score_pct: number | null }>> {
  const parsed = responseSchema.safeParse(responses);
  if (!parsed.success || !z.string().uuid().safeParse(clientSubmissionId).success) return { ok: false, message: "ข้อมูลไม่ถูกต้อง" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_inspection", {
    p_inspection_id: inspectionId, p_responses: parsed.data, p_summary: summary || null, p_client_submission_id: clientSubmissionId,
  });
  if (error) return toActionError(error, "ส่งผลตรวจไม่สำเร็จ");
  return { ok: true, data: data as never, message: "ส่งผลตรวจเรียบร้อยแล้ว" };
}
