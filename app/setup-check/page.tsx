import { headers } from "next/headers";
import { CheckCircle2, MinusCircle, XCircle } from "lucide-react";
import { runHealthChecks } from "@/lib/health";

export const dynamic = "force-dynamic";
export const metadata = { title: "ตรวจการตั้งค่าระบบ" };

export default async function SetupCheck({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const sp = await searchParams;
  const h = await headers();
  const checks = await runHealthChecks(h.get("x-forwarded-host") ?? h.get("host") ?? undefined);
  const allOk = checks.every((c) => c.ok !== false);
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-bold text-ink">ตรวจการตั้งค่าระบบ</h1>
      <p className="mt-1 text-sm text-gray-600">หน้านี้ไม่แสดงค่าลับใด ๆ — ใช้ตรวจว่า Environment Variables ใน Vercel และ Supabase ตั้งค่าถูกต้องหรือไม่</p>
      {sp.from === "middleware" && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">ระบบยืนยันตัวตนทำงานไม่สำเร็จ — ดูรายการที่มีเครื่องหมาย ✗ ด้านล่าง</p>}
      <ul className="mt-6 divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white">
        {checks.map((c) => (
          <li key={c.name} className="flex gap-3 p-4">
            {c.ok === true ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-label="ผ่าน" /> : c.ok === false ? <XCircle className="h-5 w-5 shrink-0 text-red-600" aria-label="ไม่ผ่าน" /> : <MinusCircle className="h-5 w-5 shrink-0 text-gray-400" aria-label="ไม่บังคับ" />}
            <div className="min-w-0"><p className="font-mono text-sm font-semibold">{c.name}</p><p className="break-words text-sm text-gray-700">{c.detail}</p></div>
          </li>
        ))}
      </ul>
      <div className="mt-6 rounded-xl bg-gray-50 p-4 text-sm text-gray-700">
        {allOk ? <p>✅ การตั้งค่าพื้นฐานถูกต้อง — <a href="/login" className="font-medium text-brand underline">ไปหน้าเข้าสู่ระบบ</a></p> : (
          <ol className="list-decimal space-y-1 pl-5">
            <li>แก้ค่าที่มี ✗ ใน Vercel › Settings › Environment Variables (วางเฉพาะค่า ไม่ต้องมีเครื่องหมายคำพูดหรือช่องว่าง)</li>
            <li>Vercel › Deployments › รายการบนสุด › ⋯ › <b>Redeploy</b> (จำเป็นทุกครั้งที่แก้ค่า)</li>
            <li>รีเฟรชหน้านี้เพื่อตรวจอีกครั้ง</li>
          </ol>
        )}
      </div>
    </main>
  );
}
