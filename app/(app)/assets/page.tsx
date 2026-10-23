import Link from "next/link";
import { Boxes, Plus, QrCode } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireSession, hasRole, MANAGER_ROLES } from "@/lib/auth";
import { getFilterOptions } from "@/lib/queries";
import { FilterBar, qs } from "@/components/filters";
import { Badge, EmptyState, ErrorState, LinkButton, PageHeader, Table, Td, Th, inputClass, buttonClass } from "@/components/ui";
import { ASSET_STATUS_LABELS, CATEGORY_LABELS } from "@/lib/labels";
import { formatDate, formatDateTime, todayBangkok, addDays } from "@/lib/format";
import type { AssetRow } from "@/lib/types";

export const metadata = { title: "ทะเบียนจุดตรวจ" };
const PAGE = 100;

export default async function AssetsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const supabase = await createClient();
  const page = Math.max(1, Number(sp.page ?? 1));
  const today = todayBangkok();
  let q = supabase.from("v_assets").select("*", { count: "exact" });
  if (sp.org) q = q.contains("org_ancestors", [sp.org]);
  if (sp.building) q = q.eq("building_id", sp.building);
  if (sp.category) q = q.eq("category", sp.category);
  if (sp.status) q = q.eq("status", sp.status);
  if (sp.expiring) q = q.lte("expires_on", addDays(today, 60));
  if (sp.q) { const t = sp.q.replace(/[,()%]/g, ""); q = q.or(`code.ilike.%${t}%,name.ilike.%${t}%,serial_no.ilike.%${t}%`); }
  const { data, error, count } = await q.order("code").range((page - 1) * PAGE, page * PAGE - 1);
  const options = await getFilterOptions();
  const rows = (data ?? []) as AssetRow[];
  const canManage = hasRole(s, MANAGER_ROLES);
  return (
    <>
      <PageHeader title="ทะเบียนจุดตรวจและอุปกรณ์" subtitle="ข้อมูลอุปกรณ์ ตำแหน่ง รอบตรวจ และ QR Code"
        actions={canManage ? <><LinkButton href="/assets/new"><Plus className="h-4 w-4" />เพิ่มจุดตรวจ</LinkButton></> : undefined} />
      <FilterBar action="/assets" values={sp} orgs={options.orgs} buildings={options.buildings} show={["org", "building", "category"]} />
      <form method="get" className="mb-3 flex flex-wrap gap-2">
        {Object.entries(sp).filter(([k]) => !["q", "page"].includes(k)).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <input name="q" defaultValue={sp.q} placeholder="ค้นหารหัส ชื่อ หรือหมายเลขเครื่อง" className={inputClass + " sm:w-80"} />
        <button className={buttonClass("secondary")}>ค้นหา</button>
        <Link href={"/assets" + qs({ ...sp, expiring: sp.expiring ? undefined : "1" })} className={buttonClass(sp.expiring ? "primary" : "ghost")}>ใกล้หมดอายุ/หมดอายุ (60 วัน)</Link>
      </form>
      {error ? <ErrorState retryHref="/assets" /> : rows.length === 0 ? (
        <EmptyState icon={<Boxes className="h-8 w-8" />} title="ไม่พบจุดตรวจ" action={canManage ? <LinkButton href="/assets/new">เพิ่มจุดตรวจ</LinkButton> : undefined} />
      ) : (
        <form method="get" action="/assets/qr">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm text-gray-600">ทั้งหมด {count?.toLocaleString("th-TH")} รายการ</p>
            <button className={buttonClass("secondary", "sm")}><QrCode className="h-4 w-4" />พิมพ์ QR ที่เลือก</button>
          </div>
          <Table>
            <thead><tr><Th><span className="sr-only">เลือก</span></Th><Th>รหัส / ชื่อ</Th><Th>ประเภท</Th><Th>ตำแหน่ง</Th><Th>ตรวจล่าสุด / ถัดไป</Th><Th>หมดอายุ</Th><Th>สถานะ</Th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <Td><input type="checkbox" name="id" value={a.id} className="h-4 w-4" aria-label={`เลือก ${a.code}`} /></Td>
                  <Td><Link href={`/assets/${a.id}`} className="font-mono font-medium hover:text-brand">{a.code}</Link><div className="text-xs text-gray-600">{a.name}</div></Td>
                  <Td className="text-xs">{a.asset_type_name}<br /><span className="text-gray-500">{CATEGORY_LABELS[a.category]}</span></Td>
                  <Td className="text-xs">{a.organization_name}<br />{a.building_name}{a.floor_name ? ` · ${a.floor_name}` : ""}</Td>
                  <Td className="whitespace-nowrap text-xs">{formatDateTime(a.last_inspected_at, { dateOnly: true })}<br />ถัดไป {formatDate(a.next_due_on)}</Td>
                  <Td className="whitespace-nowrap text-xs">{a.expires_on ? <>{formatDate(a.expires_on)}{a.expires_on < today ? <Badge tone="critical" className="ml-1">หมดอายุ</Badge> : a.expires_on <= addDays(today, 60) ? <Badge tone="warning" className="ml-1">ใกล้หมด</Badge> : null}</> : "—"}</Td>
                  <Td><Badge tone={a.status === "active" ? "good" : "neutral"}>{ASSET_STATUS_LABELS[a.status]}</Badge>{a.open_findings > 0 && <Badge tone="serious" className="ml-1">ค้างแก้ไข {a.open_findings}</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </form>
      )}
      <div className="mt-3 flex justify-between text-sm">
        {page > 1 ? <Link className="text-brand underline" href={"/assets" + qs({ ...sp, page: page - 1 })}>‹ ก่อนหน้า</Link> : <span />}
        {(count ?? 0) > page * PAGE && <Link className="text-brand underline" href={"/assets" + qs({ ...sp, page: page + 1 })}>ถัดไป ›</Link>}
      </div>
    </>
  );
}
