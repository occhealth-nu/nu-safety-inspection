import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { buildReport, REPORT_TYPES } from "@/lib/reports";
import { getAppSettings } from "@/lib/settings";
import { formatDateTime, presetRange } from "@/lib/format";

export const runtime = "nodejs";

// ส่งออก Excel — ข้อมูลอ่านผ่าน RLS ในนามผู้ใช้ จึงได้เฉพาะข้อมูลตามสิทธิ์
export async function GET(request: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  if (!REPORT_TYPES[type]) return NextResponse.json({ ok: false, message: "ไม่พบประเภทรายงาน" }, { status: 404 });
  const sp = new URL(request.url).searchParams;
  const def = presetRange("ytd");
  const date = (v: string | null, d: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : d);
  const f = { from: date(sp.get("from"), def.from), to: date(sp.get("to"), def.to), org: sp.get("org") || undefined, building: sp.get("building") || undefined, category: sp.get("category") || undefined };
  let report;
  try { report = await buildReport(type, f); } catch { return NextResponse.json({ ok: false, message: "สร้างรายงานไม่สำเร็จ" }, { status: 500 }); }
  if (!report) return NextResponse.json({ ok: false }, { status: 404 });
  const settings = await getAppSettings();

  const wb = new ExcelJS.Workbook();
  wb.creator = settings.app_name;
  const ws = wb.addWorksheet(report.title.slice(0, 30), { views: [{ state: "frozen", ySplit: 5 }] });
  ws.addRow([`${settings.university_name_th} — ${report.title}`]).font = { bold: true, size: 14, name: "TH Sarabun New" };
  ws.addRow([report.subtitle]);
  ws.addRow([`ออกรายงานเมื่อ ${formatDateTime(new Date())} (เวลาประเทศไทย) — ข้อมูลตามสิทธิ์ของผู้ออกรายงาน`]);
  ws.addRow([]);
  const header = ws.addRow(report.columns);
  header.font = { bold: true };
  header.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE7D9" } }; c.border = { bottom: { style: "thin" } }; });
  report.rows.forEach((r) => ws.addRow(r));
  ws.columns.forEach((col, i) => { col.width = Math.min(45, Math.max(10, report.columns[i]?.length * 2 + 4)); });
  if (report.notes?.length) { ws.addRow([]); report.notes.forEach((n) => ws.addRow([`หมายเหตุ: ${n}`])); }
  if (!report.rows.length) ws.addRow(["ไม่มีข้อมูลในเงื่อนไขที่เลือก"]);
  const buf = await wb.xlsx.writeBuffer();
  const name = `nu-safety-${type}-${f.from}_${f.to}.xlsx`;
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(report.title)}.xlsx`,
      "Cache-Control": "no-store",
    },
  });
}
