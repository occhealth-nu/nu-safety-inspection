import Link from "next/link";
import { AlertTriangle, CheckCircle2, ClipboardList, Clock, RefreshCw, ShieldAlert, Wrench, Boxes, Timer, Percent } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import { getFilterOptions } from "@/lib/queries";
import { FilterBar, resolvePeriod, qs, type FilterValues } from "@/components/filters";
import { CoverageTrend, FindingsTrend, CategoryBars, StatusMeter, type TrendPoint } from "@/components/charts";
import { Card, ErrorState, PageHeader, Badge, EmptyState } from "@/components/ui";
import { formatDate, formatDateTime, formatNumber, formatPct, presetRange, MONTHS_TH, todayBangkok, toBE, endOfMonth } from "@/lib/format";
import { CATEGORY_LABELS, ACTION_LABELS } from "@/lib/labels";
import type { DashboardKpis } from "@/lib/types";

export const metadata = { title: "แดชบอร์ด" };

const STATUS_COLORS = { upcoming: "#9ca3af", pending: "#0284c7", done: "#059669", overdue: "#dc2626", waiting: "#d97706", in_progress: "#0284c7", pending_verification: "#7c3aed", closed: "#059669", pass: "#059669", fail: "#dc2626", na: "#9ca3af" };

function Kpi({ label, value, sub, formula, href, icon, tone = "default" }: {
  label: string; value: string; sub?: string; formula: string; href: string; icon: React.ReactNode; tone?: "default" | "alert" | "good";
}) {
  return (
    <Link href={href} className="group flex flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-brand hover:shadow">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-gray-600">{label}</span>
        <span className={tone === "alert" ? "text-red-600" : tone === "good" ? "text-emerald-600" : "text-gray-400"}>{icon}</span>
      </div>
      <span className="mt-1 text-3xl font-bold text-ink">{value}</span>
      {sub && <span className="text-sm text-gray-600">{sub}</span>}
      <span className="mt-2 border-t border-gray-100 pt-2 text-[11px] leading-snug text-gray-500" title="สูตรคำนวณ">{formula}</span>
    </Link>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<FilterValues> }) {
  await requireSession();
  const f = await searchParams;
  const { from, to } = resolvePeriod(f, presetRange);
  const supabase = await createClient();
  const args = { p_org: f.org || null, p_building: f.building || null, p_category: f.category || null, p_assignee: f.assignee || null };
  const today = todayBangkok();
  const year = Number(to.slice(0, 4));
  const trendFrom = (() => { const d = new Date(to + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() - 11); return d.toISOString().slice(0, 8) + "01"; })();

  const [kpiRes, trendRes, catRes, annualRes, actRes, options] = await Promise.all([
    supabase.rpc("dashboard_kpis", { p_from: from, p_to: to, ...args }),
    supabase.rpc("dashboard_trend", { p_from: trendFrom, p_to: to, ...args }),
    supabase.rpc("dashboard_findings_by_category", { p_from: from, p_to: to, ...args }),
    supabase.rpc("dashboard_annual", { p_year: year, p_group: "category", ...args }),
    supabase.rpc("dashboard_recent_activity", { p_limit: 12, p_org: f.org || null }),
    getFilterOptions(),
  ]);

  if (kpiRes.error) {
    return (<><PageHeader title="แดชบอร์ด" /><ErrorState message="ไม่สามารถคำนวณตัวชี้วัดได้ กรุณาลองใหม่อีกครั้ง" retryHref="/" /></>);
  }
  const k = kpiRes.data as DashboardKpis;
  const trend = (trendRes.data ?? []) as TrendPoint[];
  const cats = (catRes.data ?? []) as { category: string; total: number; open: number; closed: number; urgent: number }[];
  const annual = (annualRes.data ?? []) as { group_key: string; group_label: string; month: number; due: number; done: number; overdue: number }[];
  const activity = (actRes.data ?? []) as { at: string; kind: string; title: string; detail: string; link: string; actor: string | null }[];

  const base = { org: f.org, building: f.building, category: f.category, assignee: f.assignee };
  const taskLink = (extra: Record<string, string | undefined>) => "/tasks" + qs({ ...base, from, to, ...extra });
  const findingLink = (extra: Record<string, string | undefined>) => "/findings" + qs({ ...base, ...extra });

  const annualRows = Array.from(new Set(annual.map((a) => a.group_key)));

  return (
    <>
      <PageHeader title="แดชบอร์ดความปลอดภัย"
        subtitle={<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>ช่วงเวลา {formatDate(from)} – {formatDate(to)}</span>
          <span className="inline-flex items-center gap-1 text-gray-500"><RefreshCw className="h-3.5 w-3.5" aria-hidden />ข้อมูล ณ {formatDateTime(k.generated_at)}</span>
        </span>}
        actions={<Link href={"/" + qs({ ...base, preset: f.preset, from: f.from, to: f.to })} className="text-sm text-brand underline" prefetch={false}>รีเฟรชข้อมูล</Link>}
      />
      <FilterBar values={f} orgs={options.orgs} buildings={options.buildings} people={options.people} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="จุดตรวจ/อุปกรณ์ที่ใช้งานอยู่" value={formatNumber(k.assets_active)} icon={<Boxes className="h-5 w-5" />}
          formula="นับอุปกรณ์สถานะ “ใช้งานอยู่” ตามตัวกรอง (ไม่ใช้เป็นตัวหารความครอบคลุม)" href={"/assets" + qs({ ...base, status: "active" })} />
        <Kpi label="งานตรวจที่ถึงกำหนดในช่วงเวลา" value={formatNumber(k.tasks.due)} icon={<ClipboardList className="h-5 w-5" />}
          sub={`ตรวจแล้ว ${formatNumber(k.tasks.done)} · ยังไม่ตรวจ ${formatNumber(k.tasks.not_done)}`}
          formula="งานตรวจที่วันครบกำหนดอยู่ในช่วงเวลาที่เลือก (ไม่รวมงานที่ยกเลิก)" href={taskLink({})} />
        <Kpi label="ความครอบคลุมการตรวจ" value={formatPct(k.tasks.coverage_pct)} tone="good" icon={<Percent className="h-5 w-5" />}
          sub={`${formatNumber(k.tasks.done)} จาก ${formatNumber(k.tasks.due)} งาน${k.tasks.done_late ? ` (ส่งช้า ${k.tasks.done_late})` : ""}`}
          formula="ตรวจแล้ว ÷ งานตรวจที่ถึงกำหนดในช่วงเวลา × 100" href={taskLink({ status: "done" })} />
        <Kpi label="งานตรวจเกินกำหนด" value={formatNumber(k.tasks.overdue)} tone={k.tasks.overdue ? "alert" : "default"} icon={<Clock className="h-5 w-5" />}
          sub={`รอตรวจ ${formatNumber(k.tasks.pending)} · ยังไม่ถึงรอบ ${formatNumber(k.tasks.upcoming)}`}
          formula="งานที่ถึงกำหนดในช่วงเวลา ยังไม่ส่งผล และเลยวันครบกำหนดแล้ว" href={taskLink({ status: "overdue" })} />
        <Kpi label="ข้อบกพร่องที่ยังเปิดอยู่" value={formatNumber(k.findings.open)} icon={<Wrench className="h-5 w-5" />}
          sub={`ยังไม่มอบหมาย ${formatNumber(k.findings.unassigned)} · เกิดซ้ำ ${formatNumber(k.findings.recurring_open)}`}
          formula="ข้อบกพร่องทุกสถานะยกเว้น “ปิดงาน” ณ ปัจจุบัน (ไม่ขึ้นกับช่วงเวลา)" href={findingLink({ status: "open_all" })} />
        <Kpi label="ข้อบกพร่องเร่งด่วนที่ยังเปิด" value={formatNumber(k.findings.urgent_open)} tone={k.findings.urgent_open ? "alert" : "default"} icon={<ShieldAlert className="h-5 w-5" />}
          formula="ยังไม่ปิดงาน และระดับความเร่งด่วน “สูง” หรือ “วิกฤต”" href={findingLink({ status: "open_all", urgent: "1" })} />
        <Kpi label="งานแก้ไขเกินกำหนด" value={formatNumber(k.findings.overdue)} tone={k.findings.overdue ? "alert" : "default"} icon={<AlertTriangle className="h-5 w-5" />}
          formula="สถานะ “มอบหมาย” หรือ “กำลังแก้ไข” และเลยกำหนดแล้วเสร็จ (งานที่ส่งตรวจยืนยันแล้วไม่นับ)" href={findingLink({ overdue: "1" })} />
        <Kpi label="ปิดงานภายในกำหนด" value={formatPct(k.closure.on_time_pct)} tone="good" icon={<Timer className="h-5 w-5" />}
          sub={`${formatNumber(k.closure.closed_on_time)} จาก ${formatNumber(k.closure.closed_with_due)} งานที่ปิดในช่วงเวลา`}
          formula="งานที่ปิดในช่วงเวลา โดยวันที่ปิด ≤ กำหนดแล้วเสร็จ ÷ งานที่ปิดในช่วงเวลาและมีกำหนดเสร็จ × 100" href={findingLink({ status: "closed" })} />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="สถานะการตรวจ (งานที่ถึงกำหนดในช่วงเวลา)">
          <StatusMeter items={[
            { label: "ยังไม่ถึงกำหนด", value: k.tasks.upcoming, color: STATUS_COLORS.upcoming, href: taskLink({ status: "upcoming" }) },
            { label: "รอตรวจ", value: k.tasks.pending, color: STATUS_COLORS.pending, href: taskLink({ status: "pending" }) },
            { label: "ตรวจแล้ว", value: k.tasks.done, color: STATUS_COLORS.done, href: taskLink({ status: "done" }) },
            { label: "เกินกำหนด", value: k.tasks.overdue, color: STATUS_COLORS.overdue, href: taskLink({ status: "overdue" }) },
          ]} />
        </Card>
        <Card title="ผลตรวจรายข้อ (ส่งผลในช่วงเวลา)">
          <StatusMeter items={[
            { label: "ผ่าน", value: k.results.pass, color: STATUS_COLORS.pass },
            { label: "พบข้อบกพร่อง", value: k.results.fail, color: STATUS_COLORS.fail },
            { label: "ไม่เกี่ยวข้อง", value: k.results.na, color: STATUS_COLORS.na },
          ]} />
          <p className="mt-3 text-xs text-gray-500">อัตราผ่าน {formatPct(k.results.pass_rate_pct)} = ผ่าน ÷ (ผ่าน + ไม่ผ่าน) — ข้อ “ไม่เกี่ยวข้อง” ไม่นับในตัวหาร · {formatNumber(k.results.inspections)} ครั้งที่ตรวจ, พบข้อบกพร่อง {formatNumber(k.results.inspections_with_findings)} ครั้ง</p>
        </Card>
        <Card title="สถานะการแก้ไข (ข้อบกพร่องปัจจุบัน)">
          <StatusMeter items={[
            { label: "รอแก้ไข", value: k.findings.waiting, color: STATUS_COLORS.waiting, href: findingLink({ group: "waiting" }) },
            { label: "กำลังแก้ไข", value: k.findings.in_progress, color: STATUS_COLORS.in_progress, href: findingLink({ group: "in_progress" }) },
            { label: "รอตรวจยืนยัน", value: k.findings.pending_verification, color: STATUS_COLORS.pending_verification, href: findingLink({ group: "pending_verification" }) },
            { label: "ปิดงาน (ในช่วงเวลา)", value: k.closure.closed, color: STATUS_COLORS.closed, href: findingLink({ status: "closed" }) },
          ]} />
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="แนวโน้มความครอบคลุมการตรวจ 12 เดือน">
          {trend.length ? <CoverageTrend data={trend} linkFor={(p) => "/tasks" + qs({ ...base, from: p.month_start, to: endOfMonth(p.month_start) })} />
            : <EmptyState title="ยังไม่มีข้อมูล" />}
        </Card>
        <Card title="ข้อบกพร่องพบใหม่ / ปิดงาน รายเดือน">
          {trend.length ? <FindingsTrend data={trend} /> : <EmptyState title="ยังไม่มีข้อมูล" />}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="ข้อบกพร่องแยกตามหมวด (พบในช่วงเวลา)" className="lg:col-span-1">
          {cats.length ? (
            <CategoryBars rows={cats.map((c) => ({ key: c.category, label: CATEGORY_LABELS[c.category] ?? c.category, open: Number(c.open), closed: Number(c.closed), urgent: Number(c.urgent), href: findingLink({ category: c.category }) }))} />
          ) : <EmptyState title="ไม่พบข้อบกพร่องในช่วงเวลานี้" icon={<CheckCircle2 className="h-8 w-8 text-emerald-500" />} />}
        </Card>
        <Card title="กิจกรรมล่าสุด" className="lg:col-span-2">
          {activity.length ? (
            <ul className="divide-y divide-gray-100">
              {activity.map((a, i) => (
                <li key={i} className="py-2">
                  <Link href={a.link} className="flex items-start justify-between gap-3 hover:text-brand">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{a.kind === "inspection" ? "" : (ACTION_LABELS[a.kind.replace("finding_", "")] ?? "") + " · "}{a.title}</span>
                      <span className="block truncate text-xs text-gray-500">{a.detail}{a.actor ? ` — ${a.actor}` : ""}</span>
                    </span>
                    <span className="shrink-0 text-xs text-gray-500">{formatDateTime(a.at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="ยังไม่มีกิจกรรม" />}
        </Card>
      </div>

      <Card className="mt-4" title={`ตารางการตรวจรายปี พ.ศ. ${toBE(year)} (ตรวจแล้ว / ถึงกำหนด)`}
        actions={<Link href={`/reports/annual?year=${year}${qs(base).replace("?", "&")}`} className="text-sm text-brand underline">ดูรายอุปกรณ์</Link>}>
        {annualRows.length === 0 ? <EmptyState title="ยังไม่มีงานตรวจในปีนี้" description="สร้างแผนการตรวจและกด “สร้างงานตรวจ” ในเมนูแผนและงานตรวจ" /> : (
          <div className="overflow-x-auto">
            <table className="min-w-[860px] w-full text-sm">
              <thead><tr className="text-xs text-gray-500"><th className="py-2 text-left">หมวดการตรวจ</th>{MONTHS_TH.map((m) => <th key={m} className="px-1 text-center">{m}</th>)}</tr></thead>
              <tbody>
                {annualRows.map((key) => (
                  <tr key={key} className="border-t border-gray-100">
                    <td className="py-1.5 pr-2 text-gray-800">{CATEGORY_LABELS[key] ?? key}</td>
                    {Array.from({ length: 12 }).map((_, i) => {
                      const c = annual.find((a) => a.group_key === key && a.month === i + 1);
                      if (!c) return <td key={i} className="px-1 text-center text-gray-300">–</td>;
                      const monthStart = `${year}-${String(i + 1).padStart(2, "0")}-01`;
                      const complete = Number(c.done) >= Number(c.due);
                      const late = Number(c.overdue) > 0;
                      const future = monthStart > today;
                      const cls = complete ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : late ? "bg-red-50 text-red-800 ring-red-200" : future ? "bg-gray-50 text-gray-600 ring-gray-200" : "bg-sky-50 text-sky-800 ring-sky-200";
                      const sym = complete ? "✓" : late ? "!" : "";
                      return (
                        <td key={i} className="px-0.5 py-1 text-center">
                          <Link href={"/tasks" + qs({ ...base, category: key, from: monthStart, to: endOfMonth(monthStart) })}
                            title={`ตรวจแล้ว ${c.done} จากที่ถึงกำหนด ${c.due}${late ? ` · เกินกำหนด ${c.overdue}` : ""}`}
                            className={"block rounded-md px-1 py-1 text-xs font-medium ring-1 ring-inset " + cls}>
                            {sym} {c.done}/{c.due}
                          </Link>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-600">
              <Badge tone="good">✓ ครบตามกำหนด</Badge><Badge tone="critical">! มีงานเกินกำหนด</Badge><Badge tone="info">กำลังอยู่ในรอบ</Badge><Badge tone="neutral">ยังไม่ถึงรอบ</Badge>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
