import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import { signedUrls } from "@/lib/queries";
import { NoAccess, PageHeader, ExpertDraftBadge } from "@/components/ui";
import { InspectionForm } from "@/components/inspection-form";
import { CATEGORY_LABELS } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import type { ChecklistItem } from "@/lib/types";

export const metadata = { title: "บันทึกผลตรวจ" };

export default async function InspectPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  const supabase = await createClient();
  const { data: insp } = await supabase.from("v_inspections").select("*").eq("id", id).maybeSingle();
  if (!insp) return <NoAccess message="ไม่พบแบบบันทึกการตรวจ หรือคุณไม่มีสิทธิ์เข้าถึง" />;
  if (insp.status === "submitted") redirect(`/inspections/${id}`);
  if (insp.inspector_id !== s.profile?.id) return <NoAccess message="ฉบับร่างนี้เป็นของผู้ตรวจท่านอื่น" />;

  const [items, responses, attachments, version, task, asset] = await Promise.all([
    supabase.from("checklist_items").select("*").eq("version_id", insp.checklist_version_id).order("seq"),
    supabase.from("inspection_responses").select("*").eq("inspection_id", id),
    supabase.from("attachments").select("id, storage_path, item_id").eq("entity_type", "inspection").eq("entity_id", id),
    supabase.from("checklist_versions").select("version_no, is_expert_review_draft, legal_references").eq("id", insp.checklist_version_id).single(),
    insp.task_id ? supabase.from("inspection_tasks").select("due_on, period_start").eq("id", insp.task_id).single() : Promise.resolve({ data: null }),
    supabase.from("v_assets").select("location_detail, floor_name, location_name").eq("id", insp.asset_id).single(),
  ]);
  const urls = await signedUrls((attachments.data ?? []).map((a) => a.storage_path));
  const photos: Record<string, { id: string; path: string; url: string | null }[]> = {};
  (attachments.data ?? []).forEach((a) => { (photos[a.item_id ?? ""] ??= []).push({ id: a.id, path: a.storage_path, url: urls[a.storage_path] ?? null }); });

  return (
    <>
      <PageHeader title={`ตรวจ: ${insp.asset_name}`} back={{ href: "/inspect", label: "งานตรวจ" }}
        subtitle={<span className="flex flex-wrap items-center gap-2">
          <span className="font-mono">{insp.asset_code}</span><span>· {CATEGORY_LABELS[insp.category]}</span>
          <span>· {insp.building_name}{asset.data?.floor_name ? ` ${asset.data.floor_name}` : ""}{asset.data?.location_detail ? ` — ${asset.data.location_detail}` : ""}</span>
          {task.data && <span>· ครบกำหนด {formatDate(task.data.due_on)}</span>}
          <span>· แบบตรวจ {insp.template_name} v{version.data?.version_no}</span>
          {version.data?.is_expert_review_draft && <ExpertDraftBadge />}
        </span>} />
      <InspectionForm
        inspectionId={id}
        items={(items.data ?? []) as ChecklistItem[]}
        initial={(responses.data ?? []).map((r) => ({ item_id: r.item_id, result: r.result, note: r.note, na_reason: r.na_reason, urgency: r.urgency, photo_exempt_reason: r.photo_exempt_reason }))}
        initialSummary={insp.summary_note ?? ""}
        initialPhotos={photos}
      />
    </>
  );
}
