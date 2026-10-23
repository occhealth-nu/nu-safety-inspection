import { NextResponse, type NextRequest } from "next/server";
import { runHealthChecks } from "@/lib/health";

export const dynamic = "force-dynamic";

// ตรวจสถานะการตั้งค่า (ไม่แสดงค่าลับ) — ใช้แก้ปัญหาหลัง Deploy
export async function GET(request: NextRequest) {
  const checks = await runHealthChecks(request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? undefined);
  return NextResponse.json({ ok: checks.every((c) => c.ok !== false), checks }, { headers: { "Cache-Control": "no-store" } });
}
