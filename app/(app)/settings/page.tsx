import Link from "next/link";
import { Building2, ClipboardList, Bell, Palette, Users, Network, ScrollText, KeyRound } from "lucide-react";
import { requireSession, hasRole, isCentral, isSystemAdmin, MANAGER_ROLES } from "@/lib/auth";
import { NoAccess, PageHeader, NotConnected } from "@/components/ui";
import { env } from "@/lib/env";

export const metadata = { title: "ตั้งค่าระบบ" };

export default async function SettingsHome() {
  const s = await requireSession();
  if (!hasRole(s, MANAGER_ROLES)) return <NoAccess />;
  const items = [
    { href: "/settings/organizations", title: "หน่วยงาน", desc: "โครงสร้างมหาวิทยาลัย → คณะ/หน่วยงาน", icon: Network, show: isSystemAdmin(s) || isCentral(s) },
    { href: "/settings/locations", title: "อาคาร ชั้น และห้อง", desc: "ข้อมูลตำแหน่งสำหรับทะเบียนจุดตรวจ", icon: Building2, show: true },
    { href: "/settings/users", title: "ผู้ใช้และสิทธิ์", desc: "เพิ่มผู้ใช้ กำหนดบทบาทตามหน่วยงาน ระงับบัญชี", icon: Users, show: true },
    { href: "/settings/checklists", title: "แบบตรวจ", desc: "สร้าง/ปรับแบบตรวจ จัดการเวอร์ชันและแหล่งอ้างอิง", icon: ClipboardList, show: true },
    { href: "/settings/notifications", title: "การแจ้งเตือน", desc: "ระยะเวลาเตือน การยกระดับเรื่อง และอีเมล", icon: Bell, show: true },
    { href: "/settings/branding", title: "ภาพลักษณ์และการเข้าสู่ระบบ", desc: "ชื่อระบบ สีหลัก ตรามหาวิทยาลัย และโดเมนอีเมลที่อนุญาต", icon: Palette, show: isSystemAdmin(s) },
    { href: "/settings/audit", title: "ประวัติการใช้งาน (Audit log)", desc: "ตรวจสอบการเปลี่ยนแปลงข้อมูลย้อนหลัง", icon: ScrollText, show: true },
  ];
  return (
    <>
      <PageHeader title="ตั้งค่าระบบ" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.filter((i) => i.show).map((i) => (
          <Link key={i.href} href={i.href} className="flex gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-brand">
            <i.icon className="h-6 w-6 shrink-0 text-brand" aria-hidden /><span><span className="block font-semibold">{i.title}</span><span className="text-sm text-gray-600">{i.desc}</span></span>
          </Link>
        ))}
      </div>
      <div className="mt-6 space-y-2">
        <h2 className="flex items-center gap-2 font-semibold"><KeyRound className="h-5 w-5" aria-hidden />การเชื่อมต่อระบบภายนอก</h2>
        <NotConnected>เข้าสู่ระบบด้วยบัญชีมหาวิทยาลัย: {env.ssoProvider === "google" ? `เปิดใช้ Google (@${env.ssoDomain}) — ต้องตั้งค่า Google provider ใน Supabase ตาม docs/GOOGLE_LOGIN.md` : env.ssoProvider ? `ตั้งค่าผู้ให้บริการ “${env.ssoProvider}” ไว้แล้ว` : "ยังไม่ได้เปิดใช้ (ตั้ง NEXT_PUBLIC_SSO_PROVIDER=google ตาม docs/GOOGLE_LOGIN.md)"}</NotConnected>
        <NotConnected>ระบบแจ้งซ่อมกองอาคารสถานที่: ยังไม่ได้เชื่อมต่อ API — ใช้ใบงานในระบบและส่งออกเอกสาร</NotConnected>
        <NotConnected>อีเมลแจ้งเตือน: {process.env.SMTP_HOST ? "ตั้งค่า SMTP แล้ว (ส่งผ่าน /api/cron/notifications)" : "ยังไม่ได้ตั้งค่า SMTP — แจ้งเตือนเฉพาะในระบบ"}</NotConnected>
      </div>
    </>
  );
}
