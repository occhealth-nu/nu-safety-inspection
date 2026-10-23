import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import { getAppSettings } from "@/lib/settings";
import { NoAccess, NotConnected } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { formatDate, formatDateTime } from "@/lib/format";
import { SEVERITY_LABELS } from "@/lib/labels";
import type { FindingRow } from "@/lib/types";

export const metadata = { title: "ใบงาน" };

export default async function WorkOrderPrint({ params }: { params: Promise<{ id: string; wo: string }> }) {
  await requireSession();
  const { id, wo } = await params;
  const supabase = await createClient();
  const [{ data: w }, { data: f }] = await Promise.all([
    supabase.from("work_orders").select("*, profiles:created_by(full_name)").eq("id", wo).eq("finding_id", id).maybeSingle(),
    supabase.from("v_findings").select("*").eq("id", id).maybeSingle<FindingRow>(),
  ]);
  if (!w || !f) return <NoAccess />;
  const s = await getAppSettings();
  return (
    <div className="mx-auto max-w-3xl bg-white p-6 print:p-0">
      <div className="mb-4 flex justify-between print:hidden"><NotConnected>ใบงานนี้ยังไม่ได้ส่งเข้าระบบภายนอก (สถานะ: ยังไม่เชื่อมต่อ) — พิมพ์หรือบันทึก PDF แล้วส่งต่อหน่วยงานปลายทาง</NotConnected><PrintButton /></div>
      <header className="border-b-2 border-ink pb-3 text-center">
        <p className="text-sm">{s.university_name_th}</p>
        <h1 className="text-xl font-bold">ใบแจ้งงานแก้ไขข้อบกพร่องด้านความปลอดภัย</h1>
        <p className="text-sm">เลขที่ {w.wo_no} · วันที่ {formatDateTime(w.created_at, { full: true })}</p>
      </header>
      <table className="mt-4 w-full border-collapse text-sm [&_td]:border [&_td]:border-gray-400 [&_td]:p-2 [&_th]:border [&_th]:border-gray-400 [&_th]:bg-gray-50 [&_th]:p-2 [&_th]:text-left">
        <tbody>
          <tr><th className="w-44">ถึง (หน่วยงาน)</th><td>{w.target_unit}</td></tr>
          <tr><th>อ้างอิงข้อบกพร่อง</th><td>{f.finding_no} — {f.title}</td></tr>
          <tr><th>ระดับความเร่งด่วน</th><td>{SEVERITY_LABELS[f.severity]}</td></tr>
          <tr><th>จุดตรวจ/ตำแหน่ง</th><td>{f.asset_code} {f.asset_name}<br />{f.building_name}{f.location_detail ? ` — ${f.location_detail}` : ""} ({f.organization_name})</td></tr>
          <tr><th>รายละเอียดงาน</th><td className="whitespace-pre-line">{w.description}</td></tr>
          <tr><th>มาตรการเบื้องต้น</th><td>{f.initial_measure ?? "—"}</td></tr>
          <tr><th>กำหนดแล้วเสร็จ</th><td>{formatDate(f.due_on, { full: true })}</td></tr>
          <tr><th>ผู้ออกใบงาน</th><td>{(w as { profiles?: { full_name: string } }).profiles?.full_name ?? "—"}</td></tr>
        </tbody>
      </table>
      <div className="mt-10 grid grid-cols-2 gap-8 text-center text-sm">
        <div><p>ลงชื่อ ............................................</p><p>ผู้แจ้ง</p><p>วันที่ ........../........../..........</p></div>
        <div><p>ลงชื่อ ............................................</p><p>ผู้รับงาน</p><p>วันที่ ........../........../..........</p></div>
      </div>
      <p className="mt-8 text-xs text-gray-500">พิมพ์จาก {s.app_name} — สถานะการเชื่อมต่อระบบภายนอก: ยังไม่เชื่อมต่อ</p>
    </div>
  );
}
