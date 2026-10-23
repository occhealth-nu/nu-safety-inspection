import { requireSession, isSystemAdmin } from "@/lib/auth";
import { getAppSettings } from "@/lib/settings";
import { SimpleForm } from "@/components/simple-form";
import { Card, Field, NoAccess, Notice, PageHeader, inputClass } from "@/components/ui";

export const metadata = { title: "ภาพลักษณ์และการเข้าสู่ระบบ" };

export default async function BrandingPage() {
  const s = await requireSession();
  if (!isSystemAdmin(s)) return <NoAccess message="เฉพาะผู้ดูแลระบบมหาวิทยาลัย" />;
  const a = await getAppSettings();
  return (
    <>
      <PageHeader title="ภาพลักษณ์และการเข้าสู่ระบบ" back={{ href: "/settings", label: "ตั้งค่าระบบ" }} />
      <div className="max-w-2xl space-y-4">
        <Notice tone="warning">ระบบไม่สร้างตรามหาวิทยาลัยขึ้นเอง — กรุณาอัปโหลดไฟล์ตราทางการที่ได้รับอนุญาตจากหน่วยงานที่ดูแลอัตลักษณ์องค์กร หากไม่อัปโหลด ระบบจะแสดงอักษร “NU” แทน</Notice>
        <Card>
          <SimpleForm action="saveBranding">
            <Field label="ชื่อระบบ"><input name="app_name" defaultValue={a.app_name} className={inputClass} /></Field>
            <Field label="ชื่อมหาวิทยาลัย (ไทย)"><input name="university_name_th" defaultValue={a.university_name_th} className={inputClass} /></Field>
            <Field label="ชื่อมหาวิทยาลัย (อังกฤษ)"><input name="university_name_en" defaultValue={a.university_name_en} className={inputClass} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="สีหลัก (ส้ม)"><input type="color" name="primary_color" defaultValue={a.primary_color} className="h-10 w-full rounded-lg border border-gray-300" /></Field>
              <Field label="สีตัวอักษร/เทาเข้ม"><input type="color" name="dark_color" defaultValue={a.dark_color} className="h-10 w-full rounded-lg border border-gray-300" /></Field>
            </div>
            <Field label="โดเมนอีเมลที่อนุญาตให้เข้าสู่ระบบด้วย Google" required hint="คั่นด้วยเครื่องหมายจุลภาค เช่น nu.ac.th — บัญชี Google นอกโดเมนนี้จะถูกปฏิเสธที่ฐานข้อมูล">
              <input name="allowed_email_domains" defaultValue={a.allowed_email_domains.join(", ")} className={inputClass} />
            </Field>
            <Field label="ไฟล์ตรามหาวิทยาลัย" hint="PNG/SVG/WebP/JPG ไม่เกิน 2 MB">
              <input type="file" name="logo" accept="image/png,image/svg+xml,image/webp,image/jpeg" className="text-sm" />
            </Field>
            {a.logo_url && <label className="flex items-center gap-2 text-sm">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={a.logo_url} alt="ตราปัจจุบัน" className="h-10 w-10 object-contain" /><input type="checkbox" name="remove_logo" />นำตราออก</label>}
          </SimpleForm>
        </Card>
      </div>
    </>
  );
}
