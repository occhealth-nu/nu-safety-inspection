import "server-only";
import { createClient } from "@/lib/supabase/server";
import { CATEGORY_LABELS, FINDING_STATUS_LABELS, SEVERITY_LABELS, TASK_STATUS_LABELS, ASSET_STATUS_LABELS } from "@/lib/labels";
import { formatDate, formatDateTime, MONTHS_TH_FULL, toBE } from "@/lib/format";
import type { FindingRow, TaskRow, AssetRow } from "@/lib/types";

export interface ReportFilter { from: string; to: string; org?: string; building?: string; category?: string }
export interface ReportTable { title: string; subtitle: string; columns: string[]; rows: (string | number)[][]; notes?: string[] }

export const REPORT_TYPES: Record<string, { title: string; description: string }> = {
  inspections: { title: "ผลตรวจรายครั้ง", description: "รายการผลตรวจที่ส่งในช่วงเวลา พร้อมจำนวนผ่าน/ไม่ผ่าน/ไม่เกี่ยวข้อง และคะแนน" },
  monthly: { title: "สรุปรายเดือน", description: "งานถึงกำหนด/ตรวจแล้ว/ความครอบคลุม และข้อบกพร่องพบใหม่/ปิดงาน แยกตามเดือนและหมวด" },
  backlog: { title: "งานค้าง", description: "งานตรวจที่ยังไม่ตรวจ/เกินกำหนด และข้อบกพร่องที่ยังไม่ปิด ณ วันที่ออกรายงาน" },
  assets: { title: "ทะเบียนและประวัติอุปกรณ์", description: "ทะเบียนจุดตรวจ วันตรวจล่าสุด กำหนดตรวจครั้งถัดไป วันหมดอายุ และงานค้าง" },
  corrective: { title: "ผลการแก้ไข", description: "ข้อบกพร่องที่พบในช่วงเวลา สถานะ ผู้รับผิดชอบ กำหนดเสร็จ วันที่ปิดงาน และการส่งกลับ" },
};

function period(f: ReportFilter) { return `ช่วงเวลา ${formatDate(f.from)} – ${formatDate(f.to)}`; }

export async function buildReport(type: string, f: ReportFilter): Promise<ReportTable | null> {
  const supabase = await createClient();
  // ตัวกรองขอบเขตร่วม (หน่วยงานรวมหน่วยงานย่อย / อาคาร / หมวด)
  const scope = <T,>(q: T): T => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let x = q as any;
    if (f.org) x = x.contains("org_ancestors", [f.org]);
    if (f.building) x = x.eq("building_id", f.building);
    if (f.category) x = x.eq("category", f.category);
    return x as T;
  };
  if (type === "inspections") {
    const { data, error } = await scope(supabase.from("v_inspections").select("*").eq("status", "submitted")
      .gte("submitted_at", `${f.from}T00:00:00+07:00`).lte("submitted_at", `${f.to}T23:59:59+07:00`)).order("submitted_at").limit(5000);
    if (error) throw error;
    return {
      title: REPORT_TYPES.inspections.title, subtitle: period(f),
      columns: ["วันเวลาที่ส่งผล", "รหัสจุดตรวจ", "ชื่อ", "หมวด", "อาคาร", "หน่วยงาน", "ผู้ตรวจ", "แบบตรวจ (เวอร์ชัน)", "ผ่าน", "ไม่ผ่าน", "ไม่เกี่ยวข้อง", "คะแนน (%)", "ผล"],
      rows: (data ?? []).map((i) => [formatDateTime(i.submitted_at), i.asset_code, i.asset_name, CATEGORY_LABELS[i.category] ?? i.category, i.building_name,
        i.organization_name, i.inspector_name ?? "", `${i.template_name} v${i.version_no}`, i.pass_count, i.fail_count, i.na_count, i.score_pct ?? "—",
        i.overall_result === "fail" ? "พบข้อบกพร่อง" : "ผ่าน"]),
      notes: ["คะแนน = ผ่าน ÷ (ผ่าน + ไม่ผ่าน) × 100 — ข้อ “ไม่เกี่ยวข้อง” ไม่นับในตัวหาร"],
    };
  }
  if (type === "monthly") {
    const [tasks, findings] = await Promise.all([
      scope(supabase.from("v_inspection_tasks").select("due_on, category, display_status").neq("status", "cancelled").gte("due_on", f.from).lte("due_on", f.to)).limit(20000),
      scope(supabase.from("v_findings").select("created_at, closed_at, category, status").gte("created_at", `${f.from}T00:00:00+07:00`).lte("created_at", `${f.to}T23:59:59+07:00`)).limit(20000),
    ]);
    if (tasks.error) throw tasks.error;
    const key = (d: string, c: string) => `${d.slice(0, 7)}|${c}`;
    const agg = new Map<string, { due: number; done: number; overdue: number; opened: number; closed: number }>();
    const get = (k: string) => { let v = agg.get(k); if (!v) { v = { due: 0, done: 0, overdue: 0, opened: 0, closed: 0 }; agg.set(k, v); } return v; };
    (tasks.data as Pick<TaskRow, "due_on" | "category" | "display_status">[]).forEach((t) => { const v = get(key(t.due_on, t.category)); v.due++; if (t.display_status === "done") v.done++; if (t.display_status === "overdue") v.overdue++; });
    ((findings.data ?? []) as Pick<FindingRow, "created_at" | "closed_at" | "category" | "status">[]).forEach((x) => {
      const d = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date(x.created_at));
      const v = get(key(d, x.category)); v.opened++; if (x.status === "closed") v.closed++;
    });
    const rows = Array.from(agg.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => {
      const [ym, cat] = k.split("|"); const [y, m] = ym.split("-").map(Number);
      return [`${MONTHS_TH_FULL[m - 1]} ${toBE(y)}`, CATEGORY_LABELS[cat] ?? cat, v.due, v.done, v.overdue, v.due ? Math.round((v.done / v.due) * 1000) / 10 : "—", v.opened, v.closed];
    });
    return { title: REPORT_TYPES.monthly.title, subtitle: period(f),
      columns: ["เดือน", "หมวดการตรวจ", "งานถึงกำหนด", "ตรวจแล้ว", "เกินกำหนด", "ความครอบคลุม (%)", "ข้อบกพร่องพบใหม่", "ในจำนวนนั้นปิดงานแล้ว"], rows,
      notes: ["ความครอบคลุม = ตรวจแล้ว ÷ งานตรวจที่ถึงกำหนดในเดือนนั้น × 100 (ไม่ใช่จำนวนอุปกรณ์ทั้งหมด)"] };
  }
  if (type === "backlog") {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
    const [tasks, findings] = await Promise.all([
      scope(supabase.from("v_inspection_tasks").select("*").eq("status", "open").lte("period_start", today)).order("due_on").limit(5000),
      scope(supabase.from("v_findings").select("*").neq("status", "closed")).order("due_on", { nullsFirst: true }).limit(5000),
    ]);
    if (tasks.error) throw tasks.error;
    const rows: (string | number)[][] = [
      ...((tasks.data ?? []) as TaskRow[]).map((t) => ["งานตรวจ", t.asset_code, t.asset_name, CATEGORY_LABELS[t.category] ?? "", t.building_name, t.organization_name,
        TASK_STATUS_LABELS[t.display_status], t.assignee_name ?? "ยังไม่มอบหมาย", formatDate(t.due_on), ""]),
      ...((findings.data ?? []) as FindingRow[]).map((x) => ["ข้อบกพร่อง " + x.finding_no, x.asset_code, x.title, CATEGORY_LABELS[x.category] ?? "", x.building_name, x.organization_name,
        FINDING_STATUS_LABELS[x.status] + (x.is_overdue ? " (เกินกำหนด)" : ""), x.assignee_name ?? "ยังไม่มอบหมาย", formatDate(x.due_on), SEVERITY_LABELS[x.severity]]),
    ];
    return { title: REPORT_TYPES.backlog.title, subtitle: `ณ วันที่ ${formatDate(today)}`,
      columns: ["ประเภท", "รหัสจุดตรวจ", "รายละเอียด", "หมวด", "อาคาร", "หน่วยงาน", "สถานะ", "ผู้รับผิดชอบ", "ครบกำหนด", "ความเร่งด่วน"], rows };
  }
  if (type === "assets") {
    const { data, error } = await scope(supabase.from("v_assets").select("*")).order("code").limit(10000);
    if (error) throw error;
    return { title: REPORT_TYPES.assets.title, subtitle: "ทะเบียน ณ วันที่ออกรายงาน",
      columns: ["รหัส", "ชื่อ", "ประเภท", "หน่วยงาน", "อาคาร", "ชั้น", "ห้อง/พื้นที่", "ยี่ห้อ/รุ่น", "หมายเลขเครื่อง", "วันที่ติดตั้ง", "วันหมดอายุ", "ตรวจล่าสุด", "ตรวจครั้งถัดไป", "สถานะ", "ข้อบกพร่องค้าง"],
      rows: ((data ?? []) as AssetRow[]).map((a) => [a.code, a.name, a.asset_type_name, a.organization_name, a.building_name, a.floor_name ?? "", a.location_name ?? "",
        a.brand_model ?? "", a.serial_no ?? "", formatDate(a.installed_on), formatDate(a.expires_on), formatDateTime(a.last_inspected_at, { dateOnly: true }),
        formatDate(a.next_due_on), ASSET_STATUS_LABELS[a.status], a.open_findings]) };
  }
  if (type === "corrective") {
    const { data, error } = await scope(supabase.from("v_findings").select("*")
      .gte("created_at", `${f.from}T00:00:00+07:00`).lte("created_at", `${f.to}T23:59:59+07:00`)).order("created_at").limit(10000);
    if (error) throw error;
    const rows = ((data ?? []) as FindingRow[]).map((x) => {
      const onTime = x.closed_at && x.due_on ? (new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date(x.closed_at)) <= x.due_on ? "ภายในกำหนด" : "เกินกำหนด") : "";
      return [x.finding_no, formatDateTime(x.created_at, { dateOnly: true }), x.asset_code, x.title, CATEGORY_LABELS[x.category] ?? "", x.organization_name,
        SEVERITY_LABELS[x.severity], FINDING_STATUS_LABELS[x.status], x.assignee_name ?? "", formatDate(x.due_on), formatDateTime(x.closed_at, { dateOnly: true }), onTime,
        x.rework_count, x.recurrence_of ? "ใช่" : ""];
    });
    return { title: REPORT_TYPES.corrective.title, subtitle: period(f),
      columns: ["เลขที่", "วันที่พบ", "จุดตรวจ", "ข้อบกพร่อง", "หมวด", "หน่วยงาน", "ความเร่งด่วน", "สถานะ", "ผู้รับผิดชอบ", "กำหนดเสร็จ", "วันที่ปิดงาน", "ผลตามกำหนด", "ส่งกลับ (ครั้ง)", "เกิดซ้ำ"], rows };
  }
  return null;
}
