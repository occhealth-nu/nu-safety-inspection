import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { buildReport, REPORT_TYPES } from "@/lib/reports";
import { getAppSettings } from "@/lib/settings";
import { PrintSheet, PrintTable } from "@/components/print-sheet";
import { ErrorState } from "@/components/ui";
import { presetRange } from "@/lib/format";

export const metadata = { title: "พิมพ์รายงาน" };

export default async function PrintReport({ params, searchParams }: { params: Promise<{ type: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  await requireSession();
  const { type } = await params;
  if (!REPORT_TYPES[type]) notFound();
  const sp = await searchParams;
  const def = presetRange("ytd");
  const ok = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const f = { from: ok(sp.from) ? sp.from! : def.from, to: ok(sp.to) ? sp.to! : def.to, org: sp.org, building: sp.building, category: sp.category };
  const s = await getAppSettings();
  let r: Awaited<ReturnType<typeof buildReport>>;
  try { r = await buildReport(type, f); } catch { return <ErrorState message="สร้างรายงานไม่สำเร็จ" retryHref="/reports" />; }
  if (!r) notFound();
  return (
      <PrintSheet university={s.university_name_th} title={`รายงาน${r.title}`} subtitle={r.subtitle} back="/reports">
        <PrintTable columns={r.columns} rows={r.rows} />
        {r.notes?.map((n) => <p key={n} className="mt-2 text-xs text-gray-600">หมายเหตุ: {n}</p>)}
      </PrintSheet>
  );
}
