import Link from "next/link";
import { ClipboardList, Play, Eye } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireSession, hasRole, MANAGER_ROLES, INSPECT_ROLES } from "@/lib/auth";
import { getFilterOptions } from "@/lib/queries";
import { FilterBar, qs } from "@/components/filters";
import { AssignTasksForm } from "@/components/assign-tasks-form";
import { Badge, EmptyState, ErrorState, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { CATEGORY_LABELS, TASK_STATUS_LABELS, TASK_TONE } from "@/lib/labels";
import { formatDate, formatPct } from "@/lib/format";
import type { TaskRow } from "@/lib/types";

export const metadata = { title: "แผนและงานตรวจ" };
const PAGE = 100;

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const supabase = await createClient();
  const page = Math.max(1, Number(sp.page ?? 1));
  let q = supabase.from("v_inspection_tasks").select("*", { count: "exact" }).neq("status", "cancelled");
  if (sp.from) q = q.gte("due_on", sp.from);
  if (sp.to) q = q.lte("due_on", sp.to);
  if (sp.status) q = q.eq("display_status", sp.status);
  if (sp.org) q = q.contains("org_ancestors", [sp.org]);
  if (sp.building) q = q.eq("building_id", sp.building);
  if (sp.category) q = q.eq("category", sp.category);
  if (sp.assignee) q = q.eq("assignee_id", sp.assignee);
  if (sp.mine) q = q.eq("assignee_id", s.profile?.id ?? "");
  if (sp.q) q = q.or(`asset_code.ilike.%${sp.q.replace(/[,()]/g, "")}%,asset_name.ilike.%${sp.q.replace(/[,()]/g, "")}%`);
  const { data, error, count } = await q.order("due_on").order("asset_code").range((page - 1) * PAGE, page * PAGE - 1);
  const options = await getFilterOptions();
  const canManage = hasRole(s, MANAGER_ROLES);
  const canInspect = hasRole(s, INSPECT_ROLES);
  const rows = (data ?? []) as TaskRow[];
  const statuses = ["", "pending", "overdue", "upcoming", "done"] as const;

  return (
    <>
      <PageHeader title="แผนและงานตรวจ" subtitle="งานตรวจที่สร้างจากแผนตามรอบ — คลิกงานเพื่อเริ่มตรวจหรือดูผลตรวจ"
        actions={<>
          {canManage && <LinkButton href="/plans" variant="secondary">จัดการแผนการตรวจ</LinkButton>}
          <LinkButton href={"/tasks" + qs({ ...sp, mine: "1", page: undefined })} variant="secondary">เฉพาะงานของฉัน</LinkButton>
        </>} />
      <FilterBar action="/tasks" values={sp} orgs={options.orgs} buildings={options.buildings} people={options.people} show={["org", "building", "category", "assignee"]} />
      <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="สถานะงานตรวจ">
        {statuses.map((st) => (
          <Link key={st} href={"/tasks" + qs({ ...sp, status: st || undefined, page: undefined })} role="tab" aria-selected={(sp.status ?? "") === st}
            className={"rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset " + ((sp.status ?? "") === st ? "bg-brand text-white ring-brand" : "bg-white text-gray-700 ring-gray-300 hover:bg-gray-50")}>
            {st ? TASK_STATUS_LABELS[st] : "ทั้งหมด"}
          </Link>
        ))}
        {(sp.from || sp.to) && <span className="self-center text-sm text-gray-600">ครบกำหนด {formatDate(sp.from)} – {formatDate(sp.to)}</span>}
      </div>
      {error ? <ErrorState message="โหลดงานตรวจไม่สำเร็จ" retryHref="/tasks" /> : rows.length === 0 ? (
        <EmptyState icon={<ClipboardList className="h-8 w-8" />} title="ไม่พบงานตรวจตามเงื่อนไข"
          description={canManage ? "สร้างแผนการตรวจเพื่อให้ระบบสร้างงานตามรอบอัตโนมัติ" : "ยังไม่มีงานที่มอบหมายให้คุณในขอบเขตนี้"}
          action={canManage ? <LinkButton href="/plans">ไปที่แผนการตรวจ</LinkButton> : undefined} />
      ) : (
        <AssignTasksForm inspectors={canManage ? options.people : []}>
          <p className="mb-2 text-sm text-gray-600">ทั้งหมด {count?.toLocaleString("th-TH")} งาน</p>
          <Table>
            <thead><tr>
              {canManage && <Th><span className="sr-only">เลือก</span></Th>}
              <Th>สถานะ</Th><Th>จุดตรวจ/อุปกรณ์</Th><Th>หมวด</Th><Th>รอบ / ครบกำหนด</Th><Th>ผู้ตรวจ</Th><Th>ผลตรวจ</Th><Th></Th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50">
                  {canManage && <Td>{t.status === "open" && <input type="checkbox" name="task_id" value={t.id} aria-label={`เลือก ${t.asset_code}`} className="h-4 w-4" />}</Td>}
                  <Td><Badge tone={TASK_TONE[t.display_status]}>{TASK_STATUS_LABELS[t.display_status]}</Badge>{t.completed_late && <span className="ml-1 text-xs text-amber-700">(ส่งช้า)</span>}</Td>
                  <Td><Link href={`/assets/${t.asset_id}`} className="font-medium hover:text-brand">{t.asset_code}</Link><div className="text-xs text-gray-500">{t.asset_name} · {t.building_name}</div></Td>
                  <Td className="text-xs">{CATEGORY_LABELS[t.category] ?? t.category}</Td>
                  <Td className="whitespace-nowrap text-xs">{formatDate(t.period_start)}<br /><b>{formatDate(t.due_on)}</b></Td>
                  <Td className="text-xs">{t.assignee_name ?? <span className="text-gray-400">ยังไม่มอบหมาย</span>}</Td>
                  <Td className="text-xs">{t.status === "completed" ? (t.overall_result === "fail" ? <Badge tone="critical">พบข้อบกพร่อง {t.fail_count}</Badge> : <Badge tone="good">ผ่าน {formatPct(t.score_pct)}</Badge>) : "—"}</Td>
                  <Td>
                    {t.status === "completed" && t.completed_inspection_id ? (
                      <LinkButton href={`/inspections/${t.completed_inspection_id}`} variant="ghost" size="sm"><Eye className="h-4 w-4" />ผลตรวจ</LinkButton>
                    ) : canInspect && t.display_status !== "upcoming" ? (
                      <LinkButton href={`/inspect/start?asset=${t.asset_id}&task=${t.id}`} size="sm" prefetch={false}><Play className="h-4 w-4" />ตรวจ</LinkButton>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="mt-3 flex justify-between text-sm">
            {page > 1 ? <Link className="text-brand underline" href={"/tasks" + qs({ ...sp, page: page - 1 })}>‹ ก่อนหน้า</Link> : <span />}
            {(count ?? 0) > page * PAGE && <Link className="text-brand underline" href={"/tasks" + qs({ ...sp, page: page + 1 })}>ถัดไป ›</Link>}
          </div>
        </AssignTasksForm>
      )}
    </>
  );
}
