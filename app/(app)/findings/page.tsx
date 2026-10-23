import Link from "next/link";
import { Wrench } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import { getFilterOptions } from "@/lib/queries";
import { FilterBar, qs } from "@/components/filters";
import { Badge, EmptyState, ErrorState, PageHeader, Table, Td, Th } from "@/components/ui";
import { CATEGORY_LABELS, FINDING_STATUS_LABELS, FINDING_TONE, REMEDIATION_LABELS, SEVERITY_LABELS, SEVERITY_TONE } from "@/lib/labels";
import { formatDate, formatDateTime } from "@/lib/format";
import type { FindingRow } from "@/lib/types";

export const metadata = { title: "ติดตามแก้ไข" };
const PAGE = 100;

export default async function FindingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const supabase = await createClient();
  const page = Math.max(1, Number(sp.page ?? 1));
  let q = supabase.from("v_findings").select("*", { count: "exact" });
  if (sp.status === "open_all") q = q.neq("status", "closed");
  else if (sp.status) q = q.eq("status", sp.status);
  if (sp.group) q = q.eq("remediation_group", sp.group);
  if (sp.urgent) q = q.eq("is_urgent_open", true);
  if (sp.overdue) q = q.eq("is_overdue", true);
  if (sp.recurring) q = q.not("recurrence_of", "is", null);
  if (sp.org) q = q.contains("org_ancestors", [sp.org]);
  if (sp.building) q = q.eq("building_id", sp.building);
  if (sp.category) q = q.eq("category", sp.category);
  if (sp.assignee) q = q.eq("assignee_id", sp.assignee);
  if (sp.mine) q = q.eq("assignee_id", s.profile?.id ?? "");
  const { data, error, count } = await q.order("status").order("due_on", { nullsFirst: true }).order("created_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  const options = await getFilterOptions();
  const rows = (data ?? []) as FindingRow[];
  const tabs: [string, Record<string, string | undefined>][] = [
    ["ยังไม่ปิด", { status: "open_all" }], ["รอมอบหมาย", { status: "open" }], ["รอแก้ไข", { group: "waiting" }], ["กำลังแก้ไข", { group: "in_progress" }],
    ["รอตรวจยืนยัน", { group: "pending_verification" }], ["เกินกำหนด", { overdue: "1" }], ["เร่งด่วน", { status: "open_all", urgent: "1" }],
    ["เกิดซ้ำ", { recurring: "1" }], ["ปิดงานแล้ว", { status: "closed" }], ["งานของฉัน", { mine: "1", status: "open_all" }], ["ทั้งหมด", {}],
  ];
  const keep = { org: sp.org, building: sp.building, category: sp.category, assignee: sp.assignee };
  const isTab = (t: Record<string, string | undefined>) => ["status", "group", "urgent", "overdue", "recurring", "mine"].every((k) => (sp[k] ?? "") === (t[k] ?? ""));
  return (
    <>
      <PageHeader title="ติดตามแก้ไขข้อบกพร่อง" subtitle="พบข้อบกพร่อง → มอบหมาย → กำลังแก้ไข → รอตรวจยืนยัน → ปิดงาน" />
      <FilterBar action="/findings" values={sp} orgs={options.orgs} buildings={options.buildings} people={options.people} show={["org", "building", "category", "assignee"]} />
      <div className="mb-3 flex flex-wrap gap-2">
        {tabs.map(([label, t]) => (
          <Link key={label} href={"/findings" + qs({ ...keep, ...t })}
            className={"rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset " + (isTab(t) ? "bg-brand text-white ring-brand" : "bg-white text-gray-700 ring-gray-300 hover:bg-gray-50")}>{label}</Link>
        ))}
      </div>
      {error ? <ErrorState retryHref="/findings" /> : rows.length === 0 ? <EmptyState icon={<Wrench className="h-8 w-8" />} title="ไม่พบรายการตามเงื่อนไข" /> : (
        <>
          <p className="mb-2 text-sm text-gray-600">ทั้งหมด {count?.toLocaleString("th-TH")} รายการ</p>
          <Table>
            <thead><tr><Th>เลขที่ / ข้อบกพร่อง</Th><Th>จุดตรวจ</Th><Th>ความเร่งด่วน</Th><Th>สถานะ</Th><Th>ผู้รับผิดชอบ</Th><Th>กำหนดเสร็จ</Th><Th>พบเมื่อ</Th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((f) => (
                <tr key={f.id} className="hover:bg-gray-50">
                  <Td><Link href={`/findings/${f.id}`} className="font-mono text-xs font-semibold hover:text-brand">{f.finding_no}</Link>
                    <div className="max-w-xs text-sm">{f.title}</div>{f.recurrence_of && <Badge tone="serious">เกิดซ้ำ</Badge>}{f.rework_count > 0 && <Badge tone="warning" className="ml-1">ส่งกลับ {f.rework_count} ครั้ง</Badge>}</Td>
                  <Td className="text-xs">{f.asset_code}<br /><span className="text-gray-500">{CATEGORY_LABELS[f.category]} · {f.building_name}</span></Td>
                  <Td><Badge tone={SEVERITY_TONE[f.severity]}>{SEVERITY_LABELS[f.severity]}</Badge></Td>
                  <Td><Badge tone={FINDING_TONE[f.status]}>{FINDING_STATUS_LABELS[f.status]}</Badge><div className="mt-0.5 text-[11px] text-gray-500">{REMEDIATION_LABELS[f.remediation_group]}</div></Td>
                  <Td className="text-xs">{f.assignee_name ?? "—"}{f.responsible_org_name && <div className="text-gray-500">{f.responsible_org_name}</div>}</Td>
                  <Td className="whitespace-nowrap text-xs">{formatDate(f.due_on)}{f.is_overdue && <Badge tone="critical" className="ml-1">เกินกำหนด</Badge>}</Td>
                  <Td className="whitespace-nowrap text-xs">{formatDateTime(f.created_at, { dateOnly: true })}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="mt-3 flex justify-between text-sm">
            {page > 1 ? <Link className="text-brand underline" href={"/findings" + qs({ ...sp, page: page - 1 })}>‹ ก่อนหน้า</Link> : <span />}
            {(count ?? 0) > page * PAGE && <Link className="text-brand underline" href={"/findings" + qs({ ...sp, page: page + 1 })}>ถัดไป ›</Link>}
          </div>
        </>
      )}
    </>
  );
}
