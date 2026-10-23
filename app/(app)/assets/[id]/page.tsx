import Link from "next/link";
import { Pencil, Printer, Play } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireSession, hasRole, MANAGER_ROLES, INSPECT_ROLES } from "@/lib/auth";
import { signedUrls } from "@/lib/queries";
import { qrSvg, qrUrl } from "@/lib/qr";
import { AssetPhotos } from "@/components/asset-photo";
import { Badge, Card, LinkButton, NoAccess, Notice, PageHeader, Table, Td, Th } from "@/components/ui";
import { ASSET_STATUS_LABELS, CATEGORY_LABELS, FINDING_STATUS_LABELS, FINDING_TONE, FREQUENCY_LABELS, SEVERITY_LABELS, SEVERITY_TONE, TASK_STATUS_LABELS, TASK_TONE } from "@/lib/labels";
import { formatDate, formatDateTime, formatPct, todayBangkok } from "@/lib/format";
import type { AssetRow, FindingRow, TaskRow } from "@/lib/types";

export const metadata = { title: "รายละเอียดจุดตรวจ" };

export default async function AssetDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: a } = await supabase.from("v_assets").select("*").eq("id", id).maybeSingle<AssetRow>();
  if (!a) return <NoAccess message="ไม่พบจุดตรวจ หรือจุดตรวจอยู่นอกขอบเขตสิทธิ์ของคุณ" />;
  const [insp, fnd, tasks, photos] = await Promise.all([
    supabase.from("v_inspections").select("id, submitted_at, inspector_name, overall_result, pass_count, fail_count, na_count, score_pct, version_no, template_name").eq("asset_id", id).eq("status", "submitted").order("submitted_at", { ascending: false }).limit(50),
    supabase.from("v_findings").select("*").eq("asset_id", id).order("created_at", { ascending: false }).limit(50),
    supabase.from("v_inspection_tasks").select("*").eq("asset_id", id).eq("status", "open").order("due_on").limit(6),
    supabase.from("attachments").select("id, storage_path").eq("entity_type", "asset").eq("entity_id", id),
  ]);
  const urls = await signedUrls((photos.data ?? []).map((p) => p.storage_path));
  const svg = await qrSvg(a.qr_token, 180);
  const canEdit = hasRole(s, MANAGER_ROLES, a.organization_id, (a as unknown as { org_ancestors: string[] }).org_ancestors);
  const today = todayBangkok();
  return (
    <>
      <PageHeader title={a.name} subtitle={<span className="font-mono">{a.code}</span>} back={{ href: "/assets", label: "ทะเบียนจุดตรวจ" }}
        actions={<>
          {hasRole(s, INSPECT_ROLES) && a.status === "active" && <LinkButton href={`/inspect/start?asset=${a.id}`} prefetch={false}><Play className="h-4 w-4" />เริ่มตรวจ</LinkButton>}
          {canEdit && <LinkButton href={`/assets/${a.id}/edit`} variant="secondary"><Pencil className="h-4 w-4" />แก้ไข</LinkButton>}
          <LinkButton href={`/assets/qr?id=${a.id}`} variant="secondary"><Printer className="h-4 w-4" />พิมพ์ QR</LinkButton>
          <LinkButton href={`/reports/print/asset/${a.id}`} variant="secondary">ประวัติ (PDF)</LinkButton>
        </>} />
      {sp.saved && <div className="mb-4"><Notice tone="success">บันทึกข้อมูลจุดตรวจแล้ว</Notice></div>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="ข้อมูลจุดตรวจ">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {[
              ["ประเภท", `${a.asset_type_name} (${CATEGORY_LABELS[a.category]})`],
              ["หน่วยงาน", a.organization_name],
              ["อาคาร / ชั้น / ห้อง", [a.building_name, a.floor_name, a.location_name].filter(Boolean).join(" · ")],
              ["รายละเอียดตำแหน่ง", a.location_detail ?? "—"],
              ["ผู้รับผิดชอบ", a.responsible_name ?? "—"],
              ["ยี่ห้อ/รุ่น", a.brand_model ?? "—"],
              ["หมายเลขเครื่อง", a.serial_no ?? "—"],
              ["วันที่ติดตั้ง", formatDate(a.installed_on)],
              ["รอบตรวจ", FREQUENCY_LABELS[a.frequency] + (a.frequency === "custom" ? ` (${a.custom_interval_days} วัน)` : "")],
              ["ตรวจล่าสุด", formatDateTime(a.last_inspected_at)],
              ["กำหนดตรวจครั้งถัดไป", formatDate(a.next_due_on)],
            ].map(([k, v]) => <div key={k} className="flex gap-2"><dt className="w-36 shrink-0 text-gray-500">{k}</dt><dd>{v}</dd></div>)}
            <div className="flex gap-2"><dt className="w-36 shrink-0 text-gray-500">วันที่หมดอายุ</dt><dd>{formatDate(a.expires_on)}{a.expires_on && a.expires_on < today && <Badge tone="critical" className="ml-2">หมดอายุแล้ว</Badge>}</dd></div>
            <div className="flex gap-2"><dt className="w-36 shrink-0 text-gray-500">สถานะ</dt><dd><Badge tone={a.status === "active" ? "good" : "neutral"}>{ASSET_STATUS_LABELS[a.status]}</Badge></dd></div>
          </dl>
          {a.notes && <p className="mt-3 rounded-lg bg-gray-50 p-2 text-sm">{a.notes}</p>}
          <div className="mt-4"><p className="mb-1 text-sm font-medium">รูปภาพ</p>
            <AssetPhotos assetId={a.id} canEdit={canEdit} initial={(photos.data ?? []).map((p) => ({ id: p.id, path: p.storage_path, url: urls[p.storage_path] ?? null }))} /></div>
        </Card>
        <Card title="QR Code">
          <div className="flex flex-col items-center text-center">
            <div className="rounded-lg border border-gray-200 bg-white p-2" dangerouslySetInnerHTML={{ __html: svg }} />
            <p className="mt-2 font-mono text-lg font-bold">{a.code}</p>
            <p className="text-sm">{a.name}</p>
            <p className="mt-2 break-all text-xs text-gray-500">{qrUrl(a.qr_token)}</p>
            <p className="mt-2 text-xs text-gray-500">QR ใช้รหัสอ้างอิงถาวร ไม่มีข้อมูลส่วนบุคคล ผู้สแกนต้องเข้าสู่ระบบและมีสิทธิ์ก่อนจึงเห็นรายละเอียด</p>
          </div>
        </Card>
      </div>

      <Card className="mt-4" title="งานตรวจที่ยังเปิดอยู่">
        {(tasks.data ?? []).length === 0 ? <p className="text-sm text-gray-500">ไม่มี</p> : (
          <ul className="flex flex-wrap gap-2">{(tasks.data as TaskRow[]).map((t) => (
            <li key={t.id} className="rounded-lg border border-gray-200 px-3 py-2 text-sm"><Badge tone={TASK_TONE[t.display_status]}>{TASK_STATUS_LABELS[t.display_status]}</Badge> ครบกำหนด {formatDate(t.due_on)}</li>
          ))}</ul>
        )}
      </Card>

      <Card className="mt-4" title={`ประวัติการตรวจ (${(insp.data ?? []).length})`}>
        {(insp.data ?? []).length === 0 ? <p className="text-sm text-gray-500">ยังไม่มีประวัติการตรวจ</p> : (
          <Table>
            <thead><tr><Th>วันที่ตรวจ</Th><Th>ผู้ตรวจ</Th><Th>แบบตรวจ</Th><Th>ผ่าน/ไม่ผ่าน/ไม่เกี่ยวข้อง</Th><Th>คะแนน</Th><Th>ผล</Th></tr></thead>
            <tbody className="divide-y divide-gray-100">{(insp.data ?? []).map((i) => (
              <tr key={i.id}><Td><Link className="text-brand underline" href={`/inspections/${i.id}`}>{formatDateTime(i.submitted_at)}</Link></Td><Td>{i.inspector_name}</Td>
                <Td className="text-xs">{i.template_name} v{i.version_no}</Td><Td>{i.pass_count}/{i.fail_count}/{i.na_count}</Td><Td>{formatPct(i.score_pct)}</Td>
                <Td>{i.overall_result === "fail" ? <Badge tone="critical">พบข้อบกพร่อง</Badge> : <Badge tone="good">ผ่าน</Badge>}</Td></tr>
            ))}</tbody>
          </Table>
        )}
      </Card>

      <Card className="mt-4" title={`ข้อบกพร่องของจุดตรวจนี้ (${(fnd.data ?? []).length})`}>
        {(fnd.data ?? []).length === 0 ? <p className="text-sm text-gray-500">ไม่มี</p> : (
          <ul className="divide-y divide-gray-100">{(fnd.data as FindingRow[]).map((f) => (
            <li key={f.id} className="py-2"><Link href={`/findings/${f.id}`} className="flex flex-wrap items-center gap-2 text-sm hover:text-brand">
              <span className="font-mono">{f.finding_no}</span><span>{f.title}</span><Badge tone={SEVERITY_TONE[f.severity]}>{SEVERITY_LABELS[f.severity]}</Badge>
              <Badge tone={FINDING_TONE[f.status]}>{FINDING_STATUS_LABELS[f.status]}</Badge>{f.recurrence_of && <Badge tone="serious">เกิดซ้ำ ครั้งที่ {f.recurrence_count + 1}</Badge>}
              <span className="text-xs text-gray-500">{formatDateTime(f.created_at, { dateOnly: true })}</span></Link></li>
          ))}</ul>
        )}
      </Card>
    </>
  );
}
