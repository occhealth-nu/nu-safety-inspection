import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import { getAppSettings } from "@/lib/settings";
import { PrintSheet, PrintTable } from "@/components/print-sheet";
import { NoAccess } from "@/components/ui";
import { ACTION_LABELS, FINDING_STATUS_LABELS, SEVERITY_LABELS } from "@/lib/labels";
import { formatDate, formatDateTime } from "@/lib/format";
import type { FindingRow } from "@/lib/types";

export default async function PrintFinding({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  const supabase = await createClient();
  const { data: f } = await supabase.from("v_findings").select("*").eq("id", id).maybeSingle<FindingRow>();
  if (!f) return <NoAccess />;
  const { data: acts } = await supabase.from("corrective_actions").select("*, profiles:actor_id(full_name)").eq("finding_id", id).order("created_at");
  const s = await getAppSettings();
  return (
    <PrintSheet university={s.university_name_th} title="รายงานผลการแก้ไขข้อบกพร่อง" back={`/findings/${id}`} subtitle={`${f.finding_no} ${f.title}`}>
      <p className="mb-3 text-sm">จุดตรวจ {f.asset_code} {f.asset_name} · {f.building_name} · {f.organization_name} · ความเร่งด่วน {SEVERITY_LABELS[f.severity]} ·
        สถานะ {FINDING_STATUS_LABELS[f.status]} · ผู้รับผิดชอบ {f.assignee_name ?? "—"} · กำหนดเสร็จ {formatDate(f.due_on)} · ปิดงาน {formatDateTime(f.closed_at)}</p>
      <p className="mb-3 text-sm">รายละเอียด: {f.description}{f.initial_measure ? ` · มาตรการเบื้องต้น: ${f.initial_measure}` : ""}</p>
      <PrintTable columns={["วันเวลา", "การดำเนินการ", "ผู้ดำเนินการ", "รายละเอียด"]}
        rows={((acts ?? []) as { created_at: string; action_type: string; note: string | null; profiles: { full_name: string } | null }[]).map((a) => [formatDateTime(a.created_at), ACTION_LABELS[a.action_type] ?? a.action_type, a.profiles?.full_name ?? "", a.note ?? ""])} />
    </PrintSheet>
  );
}
