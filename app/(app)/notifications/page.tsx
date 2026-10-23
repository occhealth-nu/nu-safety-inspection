import Link from "next/link";
import { BellOff } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import { ActionButton } from "@/components/action-button";
import { EmptyState, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "การแจ้งเตือน" };

export default async function NotificationsPage() {
  const s = await requireSession();
  const supabase = await createClient();
  const { data } = await supabase.from("notifications").select("*").eq("user_id", s.profile?.id ?? "").order("created_at", { ascending: false }).limit(100);
  return (
    <>
      <PageHeader title="การแจ้งเตือน" actions={s.unread_notifications > 0 ? <ActionButton action="markAllRead">อ่านแล้วทั้งหมด</ActionButton> : undefined} />
      {(data ?? []).length === 0 ? <EmptyState icon={<BellOff className="h-8 w-8" />} title="ยังไม่มีการแจ้งเตือน" /> : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {(data ?? []).map((n) => (
            <li key={n.id}>
              <Link href={n.link ?? "#"} className={"flex gap-3 px-4 py-3 hover:bg-gray-50 " + (n.read_at ? "" : "bg-brand/5")}>
                <span className={"mt-1.5 h-2 w-2 shrink-0 rounded-full " + (n.read_at ? "bg-transparent" : "bg-brand")} aria-hidden />
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{n.title}{!n.read_at && <span className="sr-only"> (ยังไม่อ่าน)</span>}</span>
                  <span className="block text-sm text-gray-600">{n.body}</span><span className="text-xs text-gray-500">{formatDateTime(n.created_at)}</span></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
