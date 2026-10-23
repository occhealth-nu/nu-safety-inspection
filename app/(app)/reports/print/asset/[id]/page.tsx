import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import { getAppSettings } from "@/lib/settings";
import { PrintSheet, PrintTable } from "@/components/print-sheet";
import { NoAccess } from "@/components/ui";
import { FINDING_STATUS_LABELS, SEVERITY_LABELS, ASSET_STATUS_LABELS } from "@/lib/labels";
import { formatDate, formatDateTime, formatPct } from "@/lib/format";
import type { AssetRow, FindingRow } from "@/lib/types";

export default async function PrintAsset({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  const supabase = await createClient();
  const { data: a } = await supabase.from("v_assets").select("*").eq("id", id).maybeSingle<AssetRow>();
  if (!a) return <NoAccess />;
  const [insp, fnd] = await Promise.all([
    supabase.from("v_inspections").select("*").eq("asset_id", id).eq("status", "submitted").order("submitted_at"),
    supabase.from("v_findings").select("*").eq("asset_id", id).order("created_at"),
  ]);
  const s = await getAppSettings();
  return (
    <PrintSheet university={s.university_name_th} title="รายงานประวัติอุปกรณ์/จุดตรวจ" back={`/assets/${id}`} subtitle={`${a.code} ${a.name}`}>
      <p className="mb-3 text-sm">{a.asset_type_name} · {a.organization_name} · {a.building_name}{a.floor_name ? ` ${a.floor_name}` : ""}{a.location_detail ? ` — ${a.location_detail}` : ""} ·
        ยี่ห้อ/รุ่น {a.brand_model ?? "—"} · S/N {a.serial_no ?? "—"} · ติดตั้ง {formatDate(a.installed_on)} · หมดอายุ {formatDate(a.expires_on)} · สถานะ {ASSET_STATUS_LABELS[a.status]}</p>
      <h2 className="mb-1 font-semibold">ประวัติการตรวจ</h2>
      <PrintTable columns={["วันที่ตรวจ", "ผู้ตรวจ", "แบบตรวจ", "ผ่าน", "ไม่ผ่าน", "ไม่เกี่ยวข้อง", "คะแนน"]}
        rows={(insp.data ?? []).map((i) => [formatDateTime(i.submitted_at), i.inspector_name ?? "", `${i.template_name} v${i.version_no}`, i.pass_count, i.fail_count, i.na_count, formatPct(i.score_pct)])} />
      <h2 className="mb-1 mt-4 font-semibold">ข้อบกพร่องและการแก้ไข</h2>
      <PrintTable columns={["เลขที่", "วันที่พบ", "ข้อบกพร่อง", "ความเร่งด่วน", "สถานะ", "กำหนดเสร็จ", "ปิดงาน"]}
        rows={((fnd.data ?? []) as FindingRow[]).map((f) => [f.finding_no, formatDateTime(f.created_at, { dateOnly: true }), f.title, SEVERITY_LABELS[f.severity], FINDING_STATUS_LABELS[f.status], formatDate(f.due_on), formatDateTime(f.closed_at, { dateOnly: true })])} />
    </PrintSheet>
  );
}
