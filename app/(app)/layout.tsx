import { AppShell, type NavItem } from "@/components/app-shell";
import { requireSession, hasRole, INSPECT_ROLES, MANAGER_ROLES } from "@/lib/auth";
import { getAppSettings } from "@/lib/settings";
import { ROLE_LABELS } from "@/lib/labels";
import { NoAccess } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  const settings = await getAppSettings();
  // เมนูแสดงตามบทบาท (ความสะดวก) — การป้องกันจริงอยู่ที่ RLS/RPC ในฐานข้อมูล
  const nav: NavItem[] = [
    { href: "/", label: "แดชบอร์ด", icon: "dashboard", mobile: true },
    { href: "/tasks", label: "แผนและงานตรวจ", icon: "tasks", mobile: true },
  ];
  if (hasRole(s, INSPECT_ROLES)) nav.push({ href: "/inspect", label: "เริ่มตรวจ / สแกน QR", icon: "scan", mobile: true });
  nav.push({ href: "/assets", label: "ทะเบียนจุดตรวจ", icon: "assets", mobile: true });
  nav.push({ href: "/findings", label: "ติดตามแก้ไข", icon: "findings", mobile: true });
  nav.push({ href: "/reports", label: "รายงาน", icon: "reports" });
  if (hasRole(s, MANAGER_ROLES)) nav.push({ href: "/settings", label: "ตั้งค่าระบบ", icon: "settings" });

  const roleLabel = s.roles.length
    ? Array.from(new Set(s.roles.map((r) => ROLE_LABELS[r.role]))).join(", ")
    : "ยังไม่ได้รับบทบาท";
  return (
    <AppShell nav={nav} unread={s.unread_notifications}
      user={{ name: s.profile?.full_name || s.profile?.email || "ผู้ใช้", roleLabel }}
      brand={{ appName: settings.app_name, university: settings.university_name_th, logoUrl: settings.logo_url }}>
      {s.roles.length === 0 ? (
        <NoAccess message="บัญชีของคุณยังไม่ได้รับบทบาทในระบบ — ระบบแจ้งผู้ดูแลส่วนกลางแล้ว กรุณารอการกำหนดหน่วยงานและสิทธิ์ หรือติดต่อผู้ดูแลระบบของหน่วยงาน" />
      ) : children}
    </AppShell>
  );
}
