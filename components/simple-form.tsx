"use client";
import { buttonClass } from "@/components/ui";
import { FormMessage, useActionForm } from "@/components/action-button";

/** ฟอร์มทั่วไป: ส่งไปยังคำสั่ง {action} และแสดงผลหลัง Backend ตอบกลับ (สำเร็จ → โหลดหน้าใหม่พร้อมข้อความยืนยัน) */
export function SimpleForm({ action, children, submitLabel = "บันทึก", className }: {
  action: string; children: React.ReactNode; submitLabel?: string; className?: string; resetOnSuccess?: boolean;
}) {
  const { state, pending, onSubmit } = useActionForm(action);
  return (
    <form onSubmit={onSubmit} className={className ?? "space-y-3"}>
      {children}
      <FormMessage state={state} />
      <button disabled={pending} className={buttonClass("primary")}>{pending ? "กำลังบันทึก…" : submitLabel}</button>
    </form>
  );
}
