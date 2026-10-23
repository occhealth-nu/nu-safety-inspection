import Link from "next/link";
import { MapPin, Play, History } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireSession, hasRole, INSPECT_ROLES } from "@/lib/auth";
import { Badge, Card, LinkButton, NoAccess, PageHeader, Notice } from "@/components/ui";
import { ASSET_STATUS_LABELS, CATEGORY_LABELS, FINDING_STATUS_LABELS, FINDING_TONE, TASK_STATUS_LABELS, TASK_TONE } from "@/lib/labels";
import { formatDate, formatDateTime, todayBangkok } from "@/lib/format";
import type { AssetRow, FindingRow, TaskRow } from "@/lib/types";

export const metadata = { title: "ข้อมูลจุดตรวจ" };

// ปลายทางของ QR Code: ต้องเข้าสู่ระบบ (middleware) และ RLS ตรวจสิทธิ์ก่อนแสดงรายละเอียด
export default async function QrLanding({ params }: { params: Promise<{ token: string }> }) {
  const s = await requireSession();
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(token)) return <NoAccess message="QR Code ไม่ถูกต้อง" />;
  const supabase = await createClient();
  const { data: asset } = await supabase.from("v_assets").select("*").eq("qr_token", token).maybeSingle<AssetRow>();
  if (!asset) return <NoAccess message="ไม่พบจุดตรวจนี้ หรือจุดตรวจอยู่นอกขอบเขตสิทธิ์ของคุณ" />;
  const today = todayBangkok();
  const [tasks, findings] = await Promise.all([
    supabase.from("v_inspection_tasks").select("*").eq("asset_id", asset.id).eq("status", "open").lte("period_start", today).order("due_on").limit(3),
    supabase.from("v_findings").select("*").eq("asset_id", asset.id).neq("status", "closed").order("created_at", { ascending: false }).limit(5),
  ]);
  const openTask = (tasks.data ?? [])[0] as TaskRow | undefined;
  const canInspect = hasRole(s, INSPECT_ROLES) || openTask?.assignee_id === s.profile?.id;
  return (
    <>
      <PageHeader title={asset.name} subtitle={<span className="font-mono">{asset.code}</span>} back={{ href: "/inspect", label: "สแกนจุดอื่น" }} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <dl className="grid grid-cols-3 gap-y-2 text-sm">
            <dt className="text-gray-500">ประเภท</dt><dd className="col-span-2">{asset.asset_type_name} ({CATEGORY_LABELS[asset.category]})</dd>
            <dt className="text-gray-500">หน่วยงาน</dt><dd className="col-span-2">{asset.organization_name}</dd>
            <dt className="text-gray-500">ตำแหน่ง</dt><dd className="col-span-2 flex items-start gap-1"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden />{asset.building_name}{asset.floor_name ? ` · ${asset.floor_name}` : ""}{asset.location_name ? ` · ${asset.location_name}` : ""}{asset.location_detail ? ` — ${asset.location_detail}` : ""}</dd>
            <dt className="text-gray-500">สถานะ</dt><dd className="col-span-2"><Badge tone={asset.status === "active" ? "good" : "neutral"}>{ASSET_STATUS_LABELS[asset.status]}</Badge></dd>
            <dt className="text-gray-500">ตรวจล่าสุด</dt><dd className="col-span-2">{formatDateTime(asset.last_inspected_at)}</dd>
            {asset.expires_on && (<><dt className="text-gray-500">วันหมดอายุ</dt><dd className="col-span-2">{formatDate(asset.expires_on)}{asset.expires_on < today && <Badge tone="critical" className="ml-2">หมดอายุแล้ว</Badge>}</dd></>)}
          </dl>
          <div className="mt-4 flex flex-col gap-2">
            {asset.status !== "active" ? <Notice tone="warning">จุดตรวจนี้ไม่อยู่ในสถานะใช้งาน จึงไม่สามารถบันทึกผลตรวจได้</Notice> :
              canInspect ? (
                <LinkButton href={`/inspect/start?asset=${asset.id}${openTask ? `&task=${openTask.id}` : ""}`} size="lg" prefetch={false} className="w-full">
                  <Play className="h-5 w-5" />{openTask ? "เริ่มตรวจตามงานที่ถึงรอบ" : "เริ่มตรวจ (นอกรอบ)"}
                </LinkButton>
              ) : <Notice>คุณดูข้อมูลได้ แต่ไม่มีบทบาทผู้ตรวจสำหรับจุดตรวจนี้</Notice>}
            <LinkButton href={`/assets/${asset.id}`} variant="secondary" size="lg" className="w-full"><History className="h-5 w-5" />ประวัติและรายละเอียด</LinkButton>
          </div>
        </Card>
        <div className="space-y-4">
          <Card title="งานตรวจที่ถึงรอบ">
            {openTask ? (
              <p className="text-sm"><Badge tone={TASK_TONE[openTask.display_status]}>{TASK_STATUS_LABELS[openTask.display_status]}</Badge> ครบกำหนด {formatDate(openTask.due_on)} · ผู้ตรวจ {openTask.assignee_name ?? "ยังไม่มอบหมาย"}</p>
            ) : <p className="text-sm text-gray-500">ไม่มีงานตรวจที่ถึงรอบ (ตรวจครั้งถัดไป {formatDate(asset.next_due_on)})</p>}
          </Card>
          <Card title={`ข้อบกพร่องที่ยังเปิดอยู่ (${(findings.data ?? []).length})`}>
            {(findings.data ?? []).length === 0 ? <p className="text-sm text-gray-500">ไม่มี</p> : (
              <ul className="space-y-2">{(findings.data as FindingRow[]).map((f) => (
                <li key={f.id}><Link href={`/findings/${f.id}`} className="block rounded-lg border border-gray-200 p-2 text-sm hover:border-brand">
                  <span className="font-medium">{f.finding_no}</span> {f.title}<br /><Badge tone={FINDING_TONE[f.status]}>{FINDING_STATUS_LABELS[f.status]}</Badge>
                </Link></li>))}</ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
