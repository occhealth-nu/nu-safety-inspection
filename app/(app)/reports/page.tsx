import { FileSpreadsheet, FileText } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { getFilterOptions } from "@/lib/queries";
import { FilterBar, resolvePeriod, qs, type FilterValues } from "@/components/filters";
import { Card, PageHeader, buttonClass, Notice } from "@/components/ui";
import { REPORT_TYPES } from "@/lib/reports";
import { formatDate, presetRange } from "@/lib/format";

export const metadata = { title: "รายงาน" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<FilterValues> }) {
  await requireSession();
  const f = await searchParams;
  const { from, to } = resolvePeriod(f, presetRange);
  const options = await getFilterOptions();
  const q = qs({ from, to, org: f.org, building: f.building, category: f.category });
  return (
    <>
      <PageHeader title="รายงาน" subtitle={`ช่วงเวลา ${formatDate(from)} – ${formatDate(to)} · แสดงวันที่เป็นปี พ.ศ. ตามเวลาประเทศไทย`} />
      <FilterBar action="/reports" values={f} orgs={options.orgs} buildings={options.buildings} show={["period", "org", "building", "category"]} />
      <div className="mb-4"><Notice>PDF สร้างจากหน้าพิมพ์ของเบราว์เซอร์ (เลือก “บันทึกเป็น PDF”) เพื่อให้แสดงภาษาไทยถูกต้อง — Excel ดาวน์โหลดได้ทันที รายงานมีเฉพาะข้อมูลในขอบเขตสิทธิ์ของคุณ</Notice></div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Object.entries(REPORT_TYPES).map(([k, r]) => (
          <Card key={k} title={r.title}>
            <p className="min-h-[40px] text-sm text-gray-600">{r.description}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <a href={`/api/reports/${k}${q}`} className={buttonClass("primary", "sm")}><FileSpreadsheet className="h-4 w-4" />Excel</a>
              <a href={`/reports/print/${k}${q}`} className={buttonClass("secondary", "sm")}><FileText className="h-4 w-4" />PDF / พิมพ์</a>
            </div>
          </Card>
        ))}
        <Card title="ตารางตรวจรายปีรายอุปกรณ์">
          <p className="min-h-[40px] text-sm text-gray-600">ตาราง ม.ค.–ธ.ค. แสดงจำนวนที่ตรวจแล้วเทียบกับที่ถึงกำหนดของแต่ละจุดตรวจ</p>
          <div className="mt-4"><a href={`/reports/annual${qs({ year: to.slice(0, 4), org: f.org, building: f.building, category: f.category })}`} className={buttonClass("secondary", "sm")}><FileText className="h-4 w-4" />เปิด / พิมพ์</a></div>
        </Card>
      </div>
    </>
  );
}
