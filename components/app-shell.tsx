"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Suspense, useState } from "react";
import { FlashMessage } from "@/components/flash";
import {
  Bell, ClipboardCheck, ClipboardList, FileBarChart2, LayoutDashboard, LogOut, Menu, QrCode, Settings, Wrench, X, Boxes,
} from "lucide-react";
import { OfflineBanner } from "@/components/pwa";

export interface NavItem { href: string; label: string; icon: keyof typeof ICONS; mobile?: boolean }
const ICONS = { dashboard: LayoutDashboard, tasks: ClipboardList, scan: QrCode, assets: Boxes, findings: Wrench, reports: FileBarChart2, settings: Settings, inspect: ClipboardCheck };

export function AppShell({ nav, children, user, unread, brand }: {
  nav: NavItem[]; children: React.ReactNode; unread: number;
  user: { name: string; roleLabel: string }; brand: { appName: string; university: string; logoUrl: string | null };
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));

  const brandBlock = (
    <Link href="/" className="flex items-center gap-2" onClick={() => setOpen(false)}>
      {brand.logoUrl ? (
        // ตรามหาวิทยาลัยที่ผู้ดูแลอัปโหลด (ระบบไม่สร้างตราขึ้นเอง)
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brand.logoUrl} alt={brand.university} className="h-9 w-9 object-contain" />
      ) : (
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white" aria-hidden>NU</span>
      )}
      <span className="leading-tight">
        <span className="block text-sm font-bold text-ink">{brand.appName}</span>
        <span className="block text-xs text-gray-500">{brand.university}</span>
      </span>
    </Link>
  );

  const links = (
    <nav aria-label="เมนูหลัก" className="flex flex-col gap-1">
      {nav.map((n) => {
        const Icon = ICONS[n.icon];
        return (
          <Link key={n.href} href={n.href} onClick={() => setOpen(false)}
            aria-current={active(n.href) ? "page" : undefined}
            className={clsx("flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium",
              active(n.href) ? "bg-brand/10 text-brand" : "text-gray-700 hover:bg-gray-100")}>
            <Icon className="h-5 w-5" aria-hidden />{n.label}
          </Link>
        );
      })}
    </nav>
  );

  const userBlock = (
    <div className="border-t border-gray-200 pt-3">
      <p className="truncate text-sm font-medium text-ink">{user.name}</p>
      <p className="truncate text-xs text-gray-500">{user.roleLabel}</p>
      <Link href="/account" onClick={() => setOpen(false)} className="mt-2 block text-sm text-gray-600 hover:text-brand">บัญชีของฉัน / เปลี่ยนรหัสผ่าน</Link>
      <form action="/auth/signout" method="post" className="mt-2">
        <button className="flex items-center gap-2 text-sm text-gray-600 hover:text-red-700"><LogOut className="h-4 w-4" aria-hidden />ออกจากระบบ</button>
      </form>
    </div>
  );

  return (
    <div className="min-h-screen">
      <OfflineBanner />
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col gap-6 border-r border-gray-200 bg-white p-4 lg:flex print:hidden">
        {brandBlock}
        <div className="flex-1 overflow-y-auto">{links}</div>
        {userBlock}
      </aside>

      {/* Top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-gray-200 bg-white/95 px-4 backdrop-blur lg:ml-64 print:hidden">
        <div className="flex items-center gap-2 lg:hidden">
          <button onClick={() => setOpen(true)} className="rounded-lg p-2 hover:bg-gray-100" aria-label="เปิดเมนู"><Menu className="h-5 w-5" /></button>
          {brandBlock}
        </div>
        <div className="hidden lg:block" />
        <Link href="/notifications" className="relative rounded-lg p-2 hover:bg-gray-100" aria-label={`การแจ้งเตือน ${unread} รายการที่ยังไม่อ่าน`}>
          <Bell className="h-5 w-5" />
          {unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-red-600 px-1 text-center text-[11px] font-bold text-white">{unread > 99 ? "99+" : unread}</span>}
        </Link>
      </header>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="เมนู">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col gap-6 bg-white p-4 shadow-xl">
            <div className="flex items-center justify-between">{brandBlock}<button onClick={() => setOpen(false)} aria-label="ปิดเมนู" className="rounded-lg p-2 hover:bg-gray-100"><X className="h-5 w-5" /></button></div>
            <div className="flex-1 overflow-y-auto">{links}</div>
            {userBlock}
          </div>
        </div>
      )}

      <main className="px-4 pb-28 pt-5 sm:px-6 lg:ml-64 lg:pb-10 print:m-0 print:p-0"><Suspense fallback={null}><FlashMessage /></Suspense>{children}</main>

      {/* Mobile bottom navigation — ปุ่มใหญ่ เข้าถึงงานตรวจได้เร็ว */}
      <nav aria-label="เมนูลัด" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden print:hidden">
        {nav.filter((n) => n.mobile).slice(0, 5).map((n) => {
          const Icon = ICONS[n.icon];
          const isScan = n.icon === "scan";
          return (
            <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined}
              className={clsx("flex min-h-[60px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
                active(n.href) ? "text-brand" : "text-gray-600")}>
              {isScan ? (
                <span className="-mt-6 flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white shadow-lg ring-4 ring-white"><Icon className="h-7 w-7" aria-hidden /></span>
              ) : <Icon className="h-6 w-6" aria-hidden />}
              <span className="truncate">{n.label.split(" ")[0]}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
