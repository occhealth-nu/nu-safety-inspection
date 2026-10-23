import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import { signedUrls } from "@/lib/queries";
import { Badge, Card, ExpertDraftBadge, LinkButton, NoAccess, Notice, PageHeader } from "@/components/ui";
import { RESULT_LABELS, RESULT_TONE, SEVERITY_LABELS, SEVERITY_TONE, FINDING_STATUS_LABELS, FINDING_TONE } from "@/lib/labels";
import { formatDateTime, formatPct } from "@/lib/format";
import type { LegalReference } from "@/lib/types";

export const metadata = { title: "ผลการตรวจ" };

export default async function InspectionView({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ submitted?: string; findings?: string }> }) {
  await requireSession();
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: i } = await supabase.from("v_inspections").select("*").eq("id", id).maybeSingle();
  if (!i) return <NoAccess message="ไม่พบผลตรวจ หรือคุณไม่มีสิทธิ์เข้าถึง" />;
  const [items, responses, attachments, findings, version] = await Promise.all([
    supabase.from("checklist_items").select("*").eq("version_id", i.checklist_version_id).order("seq"),
    supabase.from("inspection_responses").select("*").eq("inspection_id", id),
    supabase.from("attachments").select("id, storage_path, item_id").eq("entity_type", "inspection").eq("entity_id", id),
    supabase.from("findings").select("id, finding_no, response_id, status").eq("inspection_id", id),
    supabase.from("checklist_versions").select("*").eq("id", i.checklist_version_id).single(),
  ]);
  const urls = await signedUrls((attachments.data ?? []).map((a) => a.storage_path));
  const respBy = new Map((responses.data ?? []).map((r) => [r.item_id, r]));
  const refs = (version.data?.legal_references ?? []) as LegalReference[];

  return (
    <>
      <PageHeader title={`ผลการตรวจ ${i.asset_code}`} subtitle={`${i.asset_name} · ${i.building_name} · ${i.organization_name}`}
        back={{ href: `/assets/${i.asset_id}`, label: "ประวัติอุปกรณ์" }}
        actions={<LinkButton href={`/reports/print/inspection/${id}`} variant="secondary">พิมพ์ / PDF</LinkButton>} />
      {sp.submitted && (
        <div className="mb-4"><Notice tone="success">ระบบบันทึกผลตรวจเรียบร้อยแล้ว{sp.findings ? ` และสร้างรายการข้อบกพร่อง ${sp.findings} รายการเพื่อติดตามแก้ไข` : ""}</Notice></div>
      )}
      {i.status === "draft" && <div className="mb-4"><Notice tone="warning">ผลตรวจนี้ยังเป็นฉบับร่าง ยังไม่ได้ส่ง</Notice></div>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1" title="สรุป">
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-gray-500">ผู้ตรวจ</dt><dd>{i.inspector_name}</dd>
            <dt className="text-gray-500">ส่งผลเมื่อ</dt><dd>{formatDateTime(i.submitted_at)}</dd>
            <dt className="text-gray-500">ผลรวม</dt><dd>{i.overall_result === "fail" ? <Badge tone="critical">พบข้อบกพร่อง</Badge> : i.overall_result === "pass" ? <Badge tone="good">ผ่าน</Badge> : "—"}</dd>
            <dt className="text-gray-500">ผ่าน/ไม่ผ่าน/ไม่เกี่ยวข้อง</dt><dd>{i.pass_count}/{i.fail_count}/{i.na_count}</dd>
            <dt className="text-gray-500">คะแนน</dt><dd>{formatPct(i.score_pct)} <span className="text-xs text-gray-500">(ไม่นับข้อไม่เกี่ยวข้อง)</span></dd>
            <dt className="text-gray-500">แบบตรวจ</dt><dd>{i.template_name} เวอร์ชัน {i.version_no}</dd>
          </dl>
          {i.summary_note && <p className="mt-3 rounded-lg bg-gray-50 p-2 text-sm">{i.summary_note}</p>}
          <div className="mt-3 space-y-1 text-xs text-gray-600">
            {version.data?.is_expert_review_draft ? <ExpertDraftBadge /> : <Badge tone="good">รับรองโดย {version.data?.approved_by_expert}</Badge>}
            {refs.length > 0 ? <ul className="list-disc pl-4">{refs.map((r, k) => <li key={k}>{r.source} ({r.edition}) ตรวจสอบเมื่อ {r.checked_on}</li>)}</ul>
              : <p>เกณฑ์ในแบบตรวจเวอร์ชันนี้ยังไม่ได้อ้างอิงกฎหมาย/มาตรฐาน</p>}
          </div>
        </Card>
        <div className="space-y-3 lg:col-span-2">
          {(items.data ?? []).map((it) => {
            const r = respBy.get(it.id);
            const f = (findings.data ?? []).find((x) => x.response_id === r?.id);
            const ph = (attachments.data ?? []).filter((a) => a.item_id === it.id);
            return (
              <div key={it.id} className="rounded-xl border border-gray-200 bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">{it.seq}. {it.title}</p>
                  {r?.result ? <Badge tone={RESULT_TONE[r.result as "pass"]}>{RESULT_LABELS[r.result as "pass"]}</Badge> : <Badge>ไม่มีข้อมูล</Badge>}
                </div>
                {r?.result === "na" && <p className="mt-1 text-xs text-gray-600">เหตุผล: {r.na_reason}</p>}
                {r?.note && <p className="mt-1 text-sm text-gray-700">{r.note}</p>}
                {r?.result === "fail" && (
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    {r.urgency && <Badge tone={SEVERITY_TONE[r.urgency as "low"]}>{SEVERITY_LABELS[r.urgency as "low"]}</Badge>}
                    {r.photo_exempt_reason && <span className="text-gray-600">ไม่แนบภาพ: {r.photo_exempt_reason}</span>}
                    {f && <Link href={`/findings/${f.id}`} className="text-brand underline">{f.finding_no} — <Badge tone={FINDING_TONE[f.status as "open"]}>{FINDING_STATUS_LABELS[f.status as "open"]}</Badge></Link>}
                  </div>
                )}
                {ph.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{ph.map((a) => urls[a.storage_path] ? (
                  <a key={a.id} href={urls[a.storage_path]} target="_blank" rel="noreferrer">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={urls[a.storage_path]} alt="ภาพหลักฐาน" className="h-20 w-20 rounded-lg object-cover" /></a>
                ) : null)}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
