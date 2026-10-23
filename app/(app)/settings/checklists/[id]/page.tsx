import { requireSession, hasRole, MANAGER_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SimpleForm } from "@/components/simple-form";
import { ActionButton } from "@/components/action-button";
import { Badge, Card, ExpertDraftBadge, Field, NoAccess, Notice, PageHeader, inputClass } from "@/components/ui";
import { CATEGORY_LABELS, SEVERITY_LABELS } from "@/lib/labels";
import { formatDateTime } from "@/lib/format";
import type { ChecklistItem, LegalReference, Severity } from "@/lib/types";

export const metadata = { title: "แก้ไขแบบตรวจ" };

function ItemFields({ it, versionId, nextSeq }: { it?: ChecklistItem; versionId: string; nextSeq: number }) {
  return (
    <>
      {it && <input type="hidden" name="id" value={it.id} />}
      <input type="hidden" name="version_id" value={versionId} />
      <div className="grid grid-cols-6 gap-2">
        <Field label="ลำดับ"><input name="seq" type="number" defaultValue={it?.seq ?? nextSeq} className={inputClass} /></Field>
        <div className="col-span-5"><Field label="หัวข้อการตรวจ" required><input name="title" defaultValue={it?.title} required className={inputClass} /></Field></div>
      </div>
      <Field label="คำอธิบาย/เกณฑ์"><input name="description" defaultValue={it?.description ?? ""} className={inputClass} /></Field>
      <Field label="วิธีตรวจ"><input name="method" defaultValue={it?.method ?? ""} className={inputClass} /></Field>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Field label="ระดับความสำคัญ"><select name="severity" defaultValue={it?.severity ?? "medium"} className={inputClass}>{(Object.keys(SEVERITY_LABELS) as Severity[]).map((k) => <option key={k} value={k}>{SEVERITY_LABELS[k]}</option>)}</select></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="allow_na" defaultChecked={it?.allow_na ?? true} />อนุญาต “ไม่เกี่ยวข้อง”</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="photo_required_on_fail" defaultChecked={it?.photo_required_on_fail ?? true} />บังคับแนบภาพเมื่อไม่ผ่าน</label>
      </div>
    </>
  );
}

export default async function ChecklistEditor({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ v?: string }> }) {
  const s = await requireSession();
  if (!hasRole(s, MANAGER_ROLES)) return <NoAccess />;
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: t }, { data: versions }] = await Promise.all([
    supabase.from("checklist_templates").select("*").eq("id", id).maybeSingle(),
    supabase.from("checklist_versions").select("*").eq("template_id", id).order("version_no", { ascending: false }),
  ]);
  if (!t) return <NoAccess message="ไม่พบแบบตรวจ" />;
  const v = (versions ?? []).find((x) => x.id === sp.v) ?? (versions ?? []).find((x) => x.status === "draft") ?? (versions ?? [])[0];
  const { data: items } = v ? await supabase.from("checklist_items").select("*").eq("version_id", v.id).order("seq") : { data: [] };
  const list = (items ?? []) as ChecklistItem[];
  const editable = v?.status === "draft";
  const refs = (v?.legal_references ?? []) as LegalReference[];
  return (
    <>
      <PageHeader title={t.name} subtitle={`${t.code} · ${CATEGORY_LABELS[t.category]}`} back={{ href: "/settings/checklists", label: "แบบตรวจ" }}
        actions={!(versions ?? []).some((x) => x.status === "draft") ? <ActionButton action="newVersion" args={[id]} variant="primary" size="md">สร้างเวอร์ชันใหม่เพื่อแก้ไข</ActionButton> : undefined} />
      <div className="mb-4 flex flex-wrap gap-2">
        {(versions ?? []).map((x) => (
          <a key={x.id} href={`?v=${x.id}`} className={"rounded-full px-3 py-1 text-sm ring-1 ring-inset " + (x.id === v?.id ? "bg-brand text-white ring-brand" : "bg-white ring-gray-300")}>
            v{x.version_no} · {x.status === "draft" ? "ร่าง" : x.status === "published" ? "ใช้งานอยู่" : "เลิกใช้"}</a>
        ))}
      </div>
      {v && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-3 lg:col-span-2">
            {!editable && <Notice>เวอร์ชันนี้{v.status === "published" ? "เผยแพร่แล้ว" : "เลิกใช้แล้ว"} (เผยแพร่ {formatDateTime(v.published_at)}) — แก้ไขไม่ได้ สร้างเวอร์ชันใหม่เพื่อปรับปรุง</Notice>}
            {list.map((it) => editable ? (
              <details key={it.id} className="rounded-xl border border-gray-200 bg-white p-3">
                <summary className="cursor-pointer text-sm"><b>{it.seq}.</b> {it.title} <Badge icon={false}>{SEVERITY_LABELS[it.severity]}</Badge></summary>
                <SimpleForm action="saveItem" className="mt-3 space-y-2"><ItemFields it={it} versionId={v.id} nextSeq={it.seq} /></SimpleForm>
                <div className="mt-2"><ActionButton action="deleteItem" args={[it.id]} variant="ghost" confirm="ลบรายการนี้?">ลบรายการ</ActionButton></div>
              </details>
            ) : (
              <div key={it.id} className="rounded-xl border border-gray-200 bg-white p-3 text-sm">
                <b>{it.seq}.</b> {it.title} <Badge icon={false}>{SEVERITY_LABELS[it.severity]}</Badge>
                {it.description && <p className="text-gray-600">{it.description}</p>}{it.method && <p className="text-xs text-gray-500">วิธีตรวจ: {it.method}</p>}
                <p className="text-xs text-gray-500">{it.allow_na ? "อนุญาตไม่เกี่ยวข้อง" : "ต้องตอบผ่าน/ไม่ผ่าน"} · {it.photo_required_on_fail ? "บังคับภาพเมื่อไม่ผ่าน" : "ไม่บังคับภาพ"}</p>
              </div>
            ))}
            {editable && <Card title="เพิ่มรายการตรวจ"><SimpleForm action="saveItem" submitLabel="เพิ่มรายการ" resetOnSuccess><ItemFields versionId={v.id} nextSeq={(list.at(-1)?.seq ?? 0) + 1} /></SimpleForm></Card>}
          </div>
          <div className="space-y-4">
            <Card title={`ข้อมูลเวอร์ชัน v${v.version_no}`}>
              {v.is_expert_review_draft ? <ExpertDraftBadge /> : <Badge tone="good">รับรองโดย {v.approved_by_expert}</Badge>}
              {editable ? (
                <SimpleForm action="saveVersionMeta" className="mt-3 space-y-2">
                  <input type="hidden" name="version_id" value={v.id} />
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_expert_review_draft" defaultChecked={v.is_expert_review_draft} />ร่างสำหรับผู้เชี่ยวชาญตรวจรับรอง</label>
                  <Field label="ผู้เชี่ยวชาญที่รับรอง" hint="จำเป็นเมื่อยกเลิกสถานะร่าง"><input name="approved_by_expert" defaultValue={v.approved_by_expert ?? ""} className={inputClass} /></Field>
                  <p className="text-sm font-medium">แหล่งอ้างอิงกฎหมาย/มาตรฐาน</p>
                  <p className="text-xs text-gray-500">ต้องระบุแหล่ง ฉบับ และวันที่ตรวจสอบ ทุกรายการ</p>
                  {[...refs, { source: "", edition: "", checked_on: "" }, { source: "", edition: "", checked_on: "" }].map((r, i) => (
                    <div key={i} className="space-y-1 rounded-lg bg-gray-50 p-2">
                      <input name="ref_source" defaultValue={r.source} placeholder="แหล่งอ้างอิง (ชื่อกฎหมาย/มาตรฐาน)" className={inputClass} />
                      <div className="grid grid-cols-2 gap-1"><input name="ref_edition" defaultValue={r.edition} placeholder="ฉบับ/ปี" className={inputClass} /><input name="ref_checked_on" type="date" defaultValue={r.checked_on} className={inputClass} /></div>
                    </div>
                  ))}
                  <Field label="บันทึกการเปลี่ยนแปลง"><textarea name="change_note" rows={2} defaultValue={v.change_note ?? ""} className={inputClass} /></Field>
                </SimpleForm>
              ) : (
                <div className="mt-3 text-sm">{refs.length ? <ul className="list-disc pl-4">{refs.map((r, i) => <li key={i}>{r.source} ({r.edition}) ตรวจสอบ {r.checked_on}</li>)}</ul> : <p className="text-gray-500">ยังไม่มีแหล่งอ้างอิง — ห้ามอ้างว่าเป็นไปตามกฎหมาย/มาตรฐาน</p>}</div>
              )}
            </Card>
            {editable && <Card title="เผยแพร่">
              <p className="mb-3 text-sm text-gray-600">เมื่อเผยแพร่ เวอร์ชันเดิมจะเลิกใช้ การตรวจใหม่ใช้เวอร์ชันนี้ ฉบับร่างที่เปิดค้างก่อนหน้ายังคงใช้เวอร์ชันเดิม</p>
              <ActionButton action="publishVersion" args={[id, v.id]} variant="success" size="md" confirm="ยืนยันเผยแพร่เวอร์ชันนี้? หลังเผยแพร่จะแก้ไขรายการไม่ได้">เผยแพร่เวอร์ชันนี้</ActionButton>
            </Card>}
          </div>
        </div>
      )}
    </>
  );
}
