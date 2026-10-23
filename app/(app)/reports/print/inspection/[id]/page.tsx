import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import { getAppSettings } from "@/lib/settings";
import { PrintSheet, PrintTable } from "@/components/print-sheet";
import { NoAccess } from "@/components/ui";
import { RESULT_LABELS, SEVERITY_LABELS } from "@/lib/labels";
import { formatDateTime, formatPct } from "@/lib/format";
import type { LegalReference } from "@/lib/types";

export default async function PrintInspection({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  const supabase = await createClient();
  const { data: i } = await supabase.from("v_inspections").select("*").eq("id", id).maybeSingle();
  if (!i) return <NoAccess />;
  const [items, resp, findings, version] = await Promise.all([
    supabase.from("checklist_items").select("*").eq("version_id", i.checklist_version_id).order("seq"),
    supabase.from("inspection_responses").select("*").eq("inspection_id", id),
    supabase.from("findings").select("response_id, finding_no").eq("inspection_id", id),
    supabase.from("checklist_versions").select("is_expert_review_draft, legal_references, approved_by_expert").eq("id", i.checklist_version_id).single(),
  ]);
  const s = await getAppSettings();
  const by = new Map((resp.data ?? []).map((r) => [r.item_id, r]));
  const fn = new Map((findings.data ?? []).map((f) => [f.response_id, f.finding_no]));
  const refs = (version.data?.legal_references ?? []) as LegalReference[];
  return (
    <PrintSheet university={s.university_name_th} title="รายงานผลการตรวจความปลอดภัย (รายครั้ง)" back={`/inspections/${id}`}
      subtitle={`${i.asset_code} ${i.asset_name} · ${i.building_name} · ${i.organization_name}`}>
      <p className="mb-2 text-sm">ผู้ตรวจ: {i.inspector_name} · ส่งผล: {formatDateTime(i.submitted_at)} · แบบตรวจ: {i.template_name} เวอร์ชัน {i.version_no} ·
        ผ่าน {i.pass_count} / ไม่ผ่าน {i.fail_count} / ไม่เกี่ยวข้อง {i.na_count} · คะแนน {formatPct(i.score_pct)}</p>
      <PrintTable columns={["ข้อ", "รายการตรวจ", "ผล", "รายละเอียด / เหตุผล", "ความเร่งด่วน", "เลขที่ข้อบกพร่อง"]}
        rows={(items.data ?? []).map((it) => { const r = by.get(it.id); return [it.seq, it.title, r?.result ? RESULT_LABELS[r.result as "pass"] : "—",
          [r?.note, r?.na_reason, r?.photo_exempt_reason ? `ไม่แนบภาพ: ${r.photo_exempt_reason}` : null].filter(Boolean).join(" / "),
          r?.urgency ? SEVERITY_LABELS[r.urgency as "low"] : "", r ? fn.get(r.id) ?? "" : ""]; })} />
      <p className="mt-3 text-xs text-gray-600">
        {version.data?.is_expert_review_draft ? "เกณฑ์ในแบบตรวจเวอร์ชันนี้เป็น “ร่างสำหรับผู้เชี่ยวชาญตรวจรับรอง” ยังไม่ได้รับรองความสอดคล้องกับกฎหมาย/มาตรฐาน" : `แบบตรวจรับรองโดย ${version.data?.approved_by_expert}`}
        {refs.length > 0 && <> · อ้างอิง: {refs.map((r) => `${r.source} (${r.edition}, ตรวจสอบ ${r.checked_on})`).join("; ")}</>}
      </p>
      {i.summary_note && <p className="mt-2 text-sm">สรุป: {i.summary_note}</p>}
      <div className="mt-10 text-right text-sm"><p>ลงชื่อ ............................................ ผู้ตรวจ</p><p>({i.inspector_name})</p></div>
    </PrintSheet>
  );
}
