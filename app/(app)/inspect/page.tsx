import Link from "next/link";
import { AlertTriangle, ChevronRight, ClipboardCheck, FileEdit } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireSession, hasRole, INSPECT_ROLES } from "@/lib/auth";
import { Badge, Card, EmptyState, NoAccess, Notice, PageHeader } from "@/components/ui";
import { QrScanner } from "@/components/qr-scanner";
import { TASK_STATUS_LABELS, TASK_TONE, CATEGORY_LABELS } from "@/lib/labels";
import { formatDate, formatDateTime, todayBangkok } from "@/lib/format";
import type { TaskRow } from "@/lib/types";

export const metadata = { title: "เริ่มตรวจ / สแกน QR" };

export default async function InspectHome({ searchParams }: { searchParams: Promise<{ error?: string; task?: string }> }) {
  const s = await requireSession();
  if (!hasRole(s, INSPECT_ROLES)) return <NoAccess message="บัญชีของคุณไม่มีบทบาทผู้ตรวจ" />;
  const sp = await searchParams;
  const supabase = await createClient();
  const today = todayBangkok();
  const me = s.profile?.id ?? "";
  const [tasksRes, draftsRes] = await Promise.all([
    supabase.from("v_inspection_tasks").select("*").eq("status", "open").eq("assignee_id", me).lte("period_start", today)
      .order("due_on").limit(50),
    supabase.from("v_inspections").select("id, asset_code, asset_name, started_at, task_id").eq("status", "draft").eq("inspector_id", me)
      .order("started_at", { ascending: false }).limit(10),
  ]);
  const tasks = (tasksRes.data ?? []) as TaskRow[];
  const drafts = draftsRes.data ?? [];
  return (
    <>
      <PageHeader title="เริ่มตรวจ / สแกน QR" subtitle="สแกน QR Code ที่จุดตรวจ หรือเลือกงานที่ได้รับมอบหมาย" />
      {sp.error && <div className="mb-4"><Notice tone="error">{sp.error}</Notice></div>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="สแกน QR Code"><QrScanner /></Card>
        <div className="space-y-4">
          {drafts.length > 0 && (
            <Card title="ฉบับร่างที่ยังไม่ส่ง">
              <ul className="divide-y divide-gray-100">
                {drafts.map((d) => (
                  <li key={d.id}><Link href={`/inspect/${d.id}`} className="flex min-h-[56px] items-center gap-3 py-2 hover:text-brand">
                    <FileEdit className="h-5 w-5 text-amber-600" aria-hidden />
                    <span className="flex-1"><span className="block font-medium">{d.asset_code} {d.asset_name}</span><span className="text-xs text-gray-500">เริ่ม {formatDateTime(d.started_at)} — ยังไม่ได้ส่งผล</span></span>
                    <ChevronRight className="h-5 w-5 text-gray-400" aria-hidden />
                  </Link></li>
                ))}
              </ul>
            </Card>
          )}
          <Card title={`งานที่ต้องตรวจของฉัน (${tasks.length})`}>
            {tasksRes.error ? <Notice tone="error">โหลดงานไม่สำเร็จ</Notice> : tasks.length === 0 ? (
              <EmptyState icon={<ClipboardCheck className="h-8 w-8 text-emerald-500" />} title="ไม่มีงานค้าง" description="งานที่ถึงรอบและมอบหมายให้คุณจะแสดงที่นี่" />
            ) : (
              <ul className="divide-y divide-gray-100">
                {tasks.map((t) => (
                  <li key={t.id}>
                    <Link href={`/inspect/start?asset=${t.asset_id}&task=${t.id}`} prefetch={false}
                      className={"flex min-h-[64px] items-center gap-3 rounded-lg px-1 py-2 hover:bg-gray-50 " + (sp.task === t.id ? "bg-brand/5 ring-1 ring-brand" : "")}>
                      {t.display_status === "overdue" ? <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" aria-hidden /> : <ClipboardCheck className="h-5 w-5 shrink-0 text-sky-600" aria-hidden />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{t.asset_code} — {t.asset_name}</span>
                        <span className="block truncate text-xs text-gray-500">{CATEGORY_LABELS[t.category]} · {t.building_name}{t.location_detail ? ` · ${t.location_detail}` : ""}</span>
                        <span className="mt-0.5 flex items-center gap-2 text-xs"><Badge tone={TASK_TONE[t.display_status]}>{TASK_STATUS_LABELS[t.display_status]}</Badge>ครบกำหนด {formatDate(t.due_on)}</span>
                      </span>
                      <ChevronRight className="h-5 w-5 text-gray-400" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
