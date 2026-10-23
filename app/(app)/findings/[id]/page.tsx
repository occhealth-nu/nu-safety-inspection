import Link from "next/link";
import clsx from "clsx";
import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireSession, hasRole, MANAGER_ROLES } from "@/lib/auth";
import { signedUrls } from "@/lib/queries";
import { AssignPanel, AssigneePanel, VerifyPanel, WorkOrderPanel } from "@/components/finding-actions";
import { Badge, Card, LinkButton, NoAccess, Notice, PageHeader } from "@/components/ui";
import { ACTION_LABELS, CATEGORY_LABELS, FINDING_FLOW, FINDING_FLOW_SHORT, FINDING_STATUS_LABELS, FINDING_TONE, SEVERITY_LABELS, SEVERITY_TONE } from "@/lib/labels";
import { formatDate, formatDateTime, todayBangkok } from "@/lib/format";
import type { FindingRow } from "@/lib/types";

export const metadata = { title: "รายละเอียดข้อบกพร่อง" };

function Photos({ list }: { list: { id: string; url?: string }[] }) {
  if (!list.length) return <p className="text-sm text-gray-500">ไม่มีภาพ</p>;
  return <div className="flex flex-wrap gap-2">{list.map((p) => p.url ? (
    <a key={p.id} href={p.url} target="_blank" rel="noreferrer">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={p.url} alt="ภาพหลักฐาน" className="h-24 w-24 rounded-lg object-cover" /></a>
  ) : <span key={p.id} className="flex h-24 w-24 items-center justify-center rounded-lg bg-gray-100 text-xs">ไฟล์</span>)}</div>;
}

export default async function FindingDetail({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  const supabase = await createClient();
  const { data: f } = await supabase.from("v_findings").select("*").eq("id", id).maybeSingle<FindingRow & { org_ancestors: string[] }>();
  if (!f) return <NoAccess message="ไม่พบรายการ หรือรายการนี้อยู่นอกขอบเขตสิทธิ์ของคุณ" />;
  const [actions, before, after, wos, responsible, response, prev] = await Promise.all([
    supabase.from("corrective_actions").select("*, profiles:actor_id(full_name)").eq("finding_id", id).order("created_at"),
    supabase.from("attachments").select("id, storage_path").eq("entity_type", "inspection").eq("entity_id", f.inspection_id).eq("item_id", f.checklist_item_id),
    supabase.from("attachments").select("id, storage_path, kind, created_at").eq("entity_type", "finding").eq("entity_id", id).order("created_at"),
    supabase.from("work_orders").select("*").eq("finding_id", id).order("created_at"),
    supabase.from("role_assignments").select("user_id, organization_id, profiles:user_id(full_name, is_active), organizations(name_th)").eq("role", "responsible"),
    supabase.from("inspection_responses").select("photo_exempt_reason").eq("id", f.response_id).maybeSingle(),
    f.recurrence_of ? supabase.from("findings").select("id, finding_no, created_at").eq("id", f.recurrence_of).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const urls = await signedUrls([...(before.data ?? []), ...(after.data ?? [])].map((a) => a.storage_path));
  const me = s.profile?.id;
  const canManage = hasRole(s, MANAGER_ROLES, f.organization_id, f.org_ancestors);
  const canVerify = hasRole(s, ["verifier", "safety_coordinator", "system_admin"], f.organization_id, f.org_ancestors) && me !== f.assignee_id && me !== f.fix_submitted_by;
  const isAssignee = me === f.assignee_id;
  const idx = FINDING_FLOW.indexOf(f.status);
  type Resp = { user_id: string; profiles: { full_name: string; is_active: boolean } | null; organizations: { name_th: string } | null };
  const respOpts = Array.from(new Map(((responsible.data ?? []) as unknown as Resp[]).filter((r) => r.profiles?.is_active)
    .map((r) => [r.user_id, { id: r.user_id, label: `${r.profiles?.full_name} — ${r.organizations?.name_th ?? ""}` }])).values());
  type Act = { id: string; action_type: string; note: string | null; created_at: string; progress_pct: number | null; to_status: string | null; profiles: { full_name: string } | null };

  return (
    <>
      <PageHeader title={`${f.finding_no} ${f.title}`} back={{ href: "/findings", label: "ติดตามแก้ไข" }}
        subtitle={<span className="flex flex-wrap items-center gap-2"><Badge tone={FINDING_TONE[f.status]}>{FINDING_STATUS_LABELS[f.status]}</Badge>
          <Badge tone={SEVERITY_TONE[f.severity]}>{SEVERITY_LABELS[f.severity]}</Badge>{f.is_overdue && <Badge tone="critical">เกินกำหนด</Badge>}
          {f.recurrence_of && <Badge tone="serious">เกิดซ้ำ ครั้งที่ {f.recurrence_count + 1}</Badge>}{f.rework_count > 0 && <Badge tone="warning">ส่งกลับแก้ไข {f.rework_count} ครั้ง</Badge>}</span>}
        actions={<LinkButton href={`/reports/print/finding/${id}`} variant="secondary">พิมพ์ / PDF</LinkButton>} />

      {/* ลำดับสถานะ */}
      <ol className="mb-5 grid grid-cols-5 gap-1 text-center text-[11px] sm:text-xs" aria-label="ลำดับสถานะงานแก้ไข">
        {FINDING_FLOW.map((st, i) => (
          <li key={st} aria-current={i === idx ? "step" : undefined} className="flex flex-col items-center gap-1">
            <span className={clsx("flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold", i < idx ? "bg-emerald-600 text-white" : i === idx ? "bg-brand text-white ring-4 ring-brand/20" : "bg-gray-200 text-gray-500")}>
              {i < idx ? <Check className="h-4 w-4" aria-hidden /> : i + 1}</span>
            <span className={i === idx ? "font-semibold text-ink" : "text-gray-500"}>{FINDING_FLOW_SHORT[st]}</span>
          </li>
        ))}
      </ol>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="รายละเอียด">
            <p className="whitespace-pre-line text-sm">{f.description}</p>
            <dl className="mt-3 grid grid-cols-1 gap-y-1.5 text-sm sm:grid-cols-2">
              <div><dt className="inline text-gray-500">จุดตรวจ: </dt><dd className="inline"><Link className="text-brand underline" href={`/assets/${f.asset_id}`}>{f.asset_code}</Link> {f.asset_name}</dd></div>
              <div><dt className="inline text-gray-500">หมวด: </dt><dd className="inline">{CATEGORY_LABELS[f.category]}</dd></div>
              <div><dt className="inline text-gray-500">ตำแหน่ง: </dt><dd className="inline">{f.building_name}{f.location_detail ? ` — ${f.location_detail}` : ""}</dd></div>
              <div><dt className="inline text-gray-500">หน่วยงาน: </dt><dd className="inline">{f.organization_name}</dd></div>
              <div><dt className="inline text-gray-500">ผลตรวจต้นทาง: </dt><dd className="inline"><Link className="text-brand underline" href={`/inspections/${f.inspection_id}`}>ดูผลตรวจ ({formatDateTime(f.created_at, { dateOnly: true })})</Link></dd></div>
              {prev.data && <div><dt className="inline text-gray-500">เคยพบครั้งก่อน: </dt><dd className="inline"><Link className="text-brand underline" href={`/findings/${prev.data.id}`}>{prev.data.finding_no}</Link></dd></div>}
              <div><dt className="inline text-gray-500">ผู้รับผิดชอบ: </dt><dd className="inline">{f.assignee_name ?? "ยังไม่มอบหมาย"}{f.responsible_org_name ? ` (${f.responsible_org_name})` : ""}</dd></div>
              <div><dt className="inline text-gray-500">กำหนดแล้วเสร็จ: </dt><dd className="inline">{formatDate(f.due_on)}</dd></div>
              <div><dt className="inline text-gray-500">ความคืบหน้า: </dt><dd className="inline">{f.progress_pct}%</dd></div>
              {f.closed_at && <div><dt className="inline text-gray-500">ปิดงานเมื่อ: </dt><dd className="inline">{formatDateTime(f.closed_at)}</dd></div>}
            </dl>
            {f.initial_measure && <div className="mt-3"><Notice tone="warning"><b>มาตรการเบื้องต้น:</b> {f.initial_measure}</Notice></div>}
          </Card>
          <Card title="หลักฐานก่อน–หลังแก้ไข">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div><p className="mb-1 text-sm font-medium">ก่อนแก้ไข (จากการตรวจ)</p>
                <Photos list={(before.data ?? []).map((a) => ({ id: a.id, url: urls[a.storage_path] }))} />
                {response.data?.photo_exempt_reason && <p className="mt-1 text-xs text-gray-600">ไม่แนบภาพ: {response.data.photo_exempt_reason}</p>}</div>
              <div><p className="mb-1 text-sm font-medium">หลังแก้ไข</p>
                <Photos list={(after.data ?? []).map((a) => ({ id: a.id, url: urls[a.storage_path] }))} /></div>
            </div>
          </Card>
          <Card title="ประวัติการดำเนินการ">
            <ol className="relative space-y-4 border-l-2 border-gray-200 pl-5">
              {((actions.data ?? []) as unknown as Act[]).map((a) => (
                <li key={a.id} className="relative">
                  <span className={clsx("absolute -left-[27px] top-1 h-3 w-3 rounded-full ring-4 ring-white", a.action_type === "reject" ? "bg-red-600" : a.action_type === "approve" ? "bg-emerald-600" : "bg-gray-400")} aria-hidden />
                  <p className="text-sm font-medium">{ACTION_LABELS[a.action_type] ?? a.action_type}{a.to_status && a.action_type !== "created" ? ` → ${FINDING_FLOW_SHORT[a.to_status as "open"]}` : ""}{a.progress_pct !== null ? ` (${a.progress_pct}%)` : ""}</p>
                  {a.note && <p className="whitespace-pre-line text-sm text-gray-700">{a.note}</p>}
                  <p className="text-xs text-gray-500">{a.profiles?.full_name ?? "ระบบ"} · {formatDateTime(a.created_at)}</p>
                </li>
              ))}
            </ol>
          </Card>
          {(wos.data ?? []).length > 0 && (
            <Card title="ใบงานที่ออกแล้ว">
              <ul className="space-y-1 text-sm">{(wos.data ?? []).map((w) => (
                <li key={w.id}><Link className="text-brand underline" href={`/findings/${id}/work-order/${w.id}`}>{w.wo_no}</Link> ถึง {w.target_unit} · {formatDateTime(w.created_at)} · <Badge tone="warning">ยังไม่เชื่อมต่อระบบภายนอก</Badge></li>
              ))}</ul>
            </Card>
          )}
        </div>
        <div className="space-y-4">
          {f.status === "closed" && <Notice tone="success">งานนี้ผ่านการตรวจยืนยันและปิดงานแล้ว</Notice>}
          {canManage && ["open", "assigned", "in_progress"].includes(f.status) && (
            <AssignPanel findingId={id} responsible={respOpts} minDate={todayBangkok()} current={{ assignee_id: f.assignee_id, due_on: f.due_on, initial_measure: f.initial_measure }} />
          )}
          {isAssignee && ["assigned", "in_progress"].includes(f.status) && (
            <AssigneePanel findingId={id} status={f.status} afterPhotos={(after.data ?? []).filter((a) => a.kind === "after").map((a) => ({ id: a.id, path: a.storage_path, url: urls[a.storage_path] ?? null }))} />
          )}
          {f.status === "pending_verification" && (canVerify ? <VerifyPanel findingId={id} /> :
            <Notice>รอผู้ตรวจยืนยันพิจารณา{isAssignee ? " (ผู้แก้ไขไม่สามารถยืนยันงานของตนเองได้)" : ""}</Notice>)}
          {(canManage || isAssignee) && f.status !== "closed" && (
            <WorkOrderPanel findingId={id} defaultText={`${f.finding_no} ${f.title}\nจุดตรวจ ${f.asset_code} ${f.asset_name} (${f.building_name}${f.location_detail ? ` — ${f.location_detail}` : ""})\nรายละเอียด: ${f.description}`} />
          )}
        </div>
      </div>
    </>
  );
}
