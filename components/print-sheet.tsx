import { PrintButton } from "@/components/print-button";
import { formatDateTime } from "@/lib/format";

export function PrintSheet({ university, title, subtitle, children, back }: { university: string; title: string; subtitle?: string; children: React.ReactNode; back?: string }) {
  return (
    <div className="bg-white p-4 sm:p-6 print:p-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        {back ? <a href={back} className="text-sm text-gray-600 underline">‹ กลับ</a> : <span />}
        <PrintButton />
      </div>
      <header className="mb-4 border-b-2 border-ink pb-2">
        <p className="text-sm">{university}</p>
        <h1 className="text-xl font-bold">{title}</h1>
        {subtitle && <p className="text-sm">{subtitle}</p>}
        <p className="text-xs text-gray-500">ออกรายงานเมื่อ {formatDateTime(new Date())} · ข้อมูลตามสิทธิ์ของผู้ออกรายงาน</p>
      </header>
      {children}
    </div>
  );
}

export function PrintTable({ columns, rows }: { columns: string[]; rows: (string | number)[][] }) {
  if (!rows.length) return <p className="text-sm text-gray-500">ไม่มีข้อมูลในเงื่อนไขที่เลือก</p>;
  return (
    <table className="w-full border-collapse text-[11px] [&_td]:border [&_td]:border-gray-300 [&_td]:px-1.5 [&_td]:py-1 [&_th]:border [&_th]:border-gray-300 [&_th]:bg-gray-100 [&_th]:px-1.5 [&_th]:py-1 [&_th]:text-left">
      <thead><tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i} className="break-inside-avoid">{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
    </table>
  );
}
