"use client";
import { ErrorState } from "@/components/ui";
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="space-y-3">
      <ErrorState title="เกิดข้อผิดพลาดในการแสดงหน้านี้" message="ระบบไม่สามารถโหลดข้อมูลได้ในขณะนี้ ข้อมูลที่บันทึกแล้วไม่ได้รับผลกระทบ" />
      <button onClick={reset} className="text-sm font-medium text-brand underline">ลองใหม่อีกครั้ง</button>
    </div>
  );
}
