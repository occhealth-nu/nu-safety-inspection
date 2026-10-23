import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import { getAppSettings } from "@/lib/settings";
import { PrintSheet } from "@/components/print-sheet";
import { MONTHS_TH, toBE } from "@/lib/format";

export const metadata = { title: "ตารางตรวจรายปี" };

export default async function AnnualReport({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireSession();
  const sp = await searchParams;
  const year = Number(sp.year) || new Date().getFullYear();
  const supabase = await createClient();
  const { data } = await supabase.rpc("dashboard_annual", { p_year: year, p_group: "asset", p_org: sp.org || null, p_building: sp.building || null, p_category: sp.category || null, p_assignee: null });
  const rows = (data ?? []) as { group_key: string; group_label: string; month: number; due: number; done: number; overdue: number }[];
  const keys = Array.from(new Map(rows.map((r) => [r.group_key, r.group_label])).entries());
  const s = await getAppSettings();
  return (
    <PrintSheet university={s.university_name_th} title={`ตารางการตรวจรายปี พ.ศ. ${toBE(year)} (รายจุดตรวจ)`} subtitle="แต่ละช่อง = ตรวจแล้ว / ถึงกำหนด ในเดือนนั้น" back="/reports">
      {keys.length === 0 ? <p className="text-sm text-gray-500">ไม่มีงานตรวจในปีนี้</p> : (
        <table className="w-full border-collapse text-[11px] [&_td]:border [&_td]:border-gray-300 [&_td]:px-1 [&_td]:py-0.5 [&_th]:border [&_th]:border-gray-300 [&_th]:bg-gray-100 [&_th]:px-1">
          <thead><tr><th className="text-left">จุดตรวจ</th>{MONTHS_TH.map((m) => <th key={m}>{m}</th>)}<th>รวม</th></tr></thead>
          <tbody>{keys.map(([k, label]) => {
            const cells = Array.from({ length: 12 }).map((_, i) => rows.find((r) => r.group_key === k && r.month === i + 1));
            const due = cells.reduce((a, c) => a + Number(c?.due ?? 0), 0); const done = cells.reduce((a, c) => a + Number(c?.done ?? 0), 0);
            return (<tr key={k} className="break-inside-avoid"><td>{label}</td>{cells.map((c, i) => (
              <td key={i} className={"text-center " + (!c ? "text-gray-300" : Number(c.done) >= Number(c.due) ? "bg-emerald-50" : Number(c.overdue) ? "bg-red-50 font-semibold" : "")}>
                {c ? `${Number(c.done) >= Number(c.due) ? "✓ " : Number(c.overdue) ? "! " : ""}${c.done}/${c.due}` : "–"}</td>))}
              <td className="text-center font-semibold">{done}/{due}</td></tr>);
          })}</tbody>
        </table>
      )}
      <p className="mt-2 text-xs text-gray-600">✓ = ตรวจครบตามที่ถึงกำหนด · ! = มีงานเกินกำหนด</p>
    </PrintSheet>
  );
}
