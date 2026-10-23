import { NextResponse, type NextRequest } from "next/server";
import nodemailer from "nodemailer";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * เรียกตามรอบเวลา (เช่น ทุก 1 ชั่วโมง) ด้วย header: Authorization: Bearer $CRON_SECRET
 * 1) สร้างการแจ้งเตือนใกล้ครบกำหนด/เกินกำหนด/ยกระดับ (กันซ้ำด้วย dedupe_key)
 * 2) ส่งอีเมลที่ค้างอยู่ หากตั้งค่า SMTP แล้ว — หากยังไม่ตั้งค่า จะทำเครื่องหมาย "skipped" อย่างชัดเจน
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, message: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const jobs = await admin.rpc("run_notification_jobs");
  if (jobs.error) return NextResponse.json({ ok: false, step: "jobs", message: jobs.error.message }, { status: 500 });

  const { data: pending } = await admin.from("notifications").select("id, title, body, link, email_attempts, profiles:user_id(email, full_name, is_active)")
    .eq("email_status", "pending").order("created_at").limit(200);
  let sent = 0, failed = 0, skipped = 0;
  const smtpReady = !!process.env.SMTP_HOST;
  const transport = smtpReady ? nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? 587), secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  }) : null;
  type Row = { id: string; title: string; body: string | null; link: string | null; email_attempts: number; profiles: { email: string | null; full_name: string; is_active: boolean } | null };
  for (const n of (pending ?? []) as unknown as Row[]) {
    const to = n.profiles?.email;
    if (!transport || !to || !n.profiles?.is_active) {
      await admin.from("notifications").update({ email_status: "skipped", email_error: !transport ? "SMTP not configured" : "no recipient" }).eq("id", n.id);
      skipped++; continue;
    }
    try {
      await transport.sendMail({
        from: process.env.SMTP_FROM, to, subject: `[NU Safety] ${n.title}`,
        text: `${n.title}\n\n${n.body ?? ""}\n\n${env.appUrl}${n.link ?? "/notifications"}\n\n— อีเมลอัตโนมัติจากระบบ NU Safety Inspection`,
      });
      await admin.from("notifications").update({ email_status: "sent", email_attempts: n.email_attempts + 1 }).eq("id", n.id);
      sent++;
    } catch (e) {
      const attempts = n.email_attempts + 1;
      await admin.from("notifications").update({ email_status: attempts >= 3 ? "failed" : "pending", email_attempts: attempts, email_error: String(e).slice(0, 300) }).eq("id", n.id);
      failed++;
    }
  }
  return NextResponse.json({ ok: true, jobs: jobs.data, email: { smtp_configured: smtpReady, sent, failed, skipped } });
}
