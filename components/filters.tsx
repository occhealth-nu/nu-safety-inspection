import { CATEGORY_LABELS } from "@/lib/labels";
import { buttonClass, inputClass } from "@/components/ui";
import type { Building, Organization } from "@/lib/types";

export interface FilterValues { preset?: string; from?: string; to?: string; org?: string; building?: string; category?: string; assignee?: string; year?: string }

/** แถบตัวกรองแถวเดียว (GET form — ลิงก์แชร์ได้ และทำงานได้แม้ไม่มี JavaScript) */
export function FilterBar({ values, orgs, buildings, people, show = ["period", "org", "building", "category", "assignee"], action }: {
  values: FilterValues; orgs: Organization[]; buildings: Building[]; people?: { id: string; full_name: string }[];
  show?: ("period" | "org" | "building" | "category" | "assignee" | "year")[]; action?: string;
}) {
  return (
    <form method="get" action={action} className="mb-5 grid grid-cols-2 gap-2 rounded-xl border border-gray-200 bg-white p-3 sm:flex sm:flex-wrap sm:items-end print:hidden">
      {show.includes("period") && (
        <>
          <label className="col-span-2 text-xs text-gray-600 sm:w-40">ช่วงเวลา
            <select name="preset" defaultValue={values.preset ?? "ytd"} className={inputClass}>
              <option value="ytd">ต้นปีถึงวันนี้</option>
              <option value="this_month">เดือนนี้</option>
              <option value="last_month">เดือนที่แล้ว</option>
              <option value="this_quarter">ไตรมาสนี้</option>
              <option value="fiscal_year">ปีงบประมาณ (ต.ค.–ก.ย.)</option>
              <option value="custom">กำหนดเอง</option>
            </select>
          </label>
          <label className="text-xs text-gray-600 sm:w-36">ตั้งแต่ (กำหนดเอง)<input type="date" name="from" defaultValue={values.preset === "custom" ? values.from : ""} className={inputClass} /></label>
          <label className="text-xs text-gray-600 sm:w-36">ถึง<input type="date" name="to" defaultValue={values.preset === "custom" ? values.to : ""} className={inputClass} /></label>
        </>
      )}
      {show.includes("year") && (
        <label className="text-xs text-gray-600 sm:w-28">ปี (พ.ศ.)
          <select name="year" defaultValue={values.year} className={inputClass}>
            {Array.from({ length: 5 }).map((_, i) => { const y = new Date().getFullYear() - 3 + i; return <option key={y} value={y}>{y + 543}</option>; })}
          </select>
        </label>
      )}
      {show.includes("org") && (
        <label className="col-span-2 text-xs text-gray-600 sm:w-56">หน่วยงาน
          <select name="org" defaultValue={values.org ?? ""} className={inputClass}>
            <option value="">ทุกหน่วยงานที่มีสิทธิ์</option>
            {orgs.map((o) => <option key={o.id} value={o.id}>{"— ".repeat(Math.max(0, o.ancestors.length - 1))}{o.name_th}</option>)}
          </select>
        </label>
      )}
      {show.includes("building") && (
        <label className="text-xs text-gray-600 sm:w-44">อาคาร
          <select name="building" defaultValue={values.building ?? ""} className={inputClass}>
            <option value="">ทุกอาคาร</option>
            {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      )}
      {show.includes("category") && (
        <label className="text-xs text-gray-600 sm:w-52">หมวดการตรวจ
          <select name="category" defaultValue={values.category ?? ""} className={inputClass}>
            <option value="">ทุกหมวด</option>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      )}
      {show.includes("assignee") && people && (
        <label className="text-xs text-gray-600 sm:w-44">ผู้รับผิดชอบ/ผู้ตรวจ
          <select name="assignee" defaultValue={values.assignee ?? ""} className={inputClass}>
            <option value="">ทุกคน</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </label>
      )}
      <div className="col-span-2 flex gap-2 sm:col-span-1">
        <button className={buttonClass("primary") + " flex-1"}>กรองข้อมูล</button>
        <a href={action ?? "?"} className={buttonClass("ghost")}>ล้าง</a>
      </div>
    </form>
  );
}

export function resolvePeriod(v: FilterValues, presetRange: (p: string) => { from: string; to: string }) {
  if (v.preset === "custom" && v.from && v.to && v.from <= v.to) return { from: v.from, to: v.to };
  return presetRange(v.preset ?? "ytd");
}

export function qs(params: Record<string, string | number | undefined | null | boolean>) {
  const u = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "" && v !== false) u.set(k, String(v)); });
  const s = u.toString();
  return s ? `?${s}` : "";
}
