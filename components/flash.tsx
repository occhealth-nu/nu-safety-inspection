"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, X } from "lucide-react";

/** ข้อความยืนยันหลัง Backend บันทึกสำเร็จ (คงอยู่แม้แผงฟอร์มเดิมหายไปหลังสถานะเปลี่ยน) */
export function FlashMessage() {
  const sp = useSearchParams();
  const msg = sp.get("flash");
  const [shown, setShown] = useState<string | null>(msg);
  const router = useRouter();
  const path = usePathname();
  useEffect(() => { setShown(msg); }, [msg]);
  if (!shown) return null;
  const close = () => {
    setShown(null);
    const next = new URLSearchParams(sp.toString()); next.delete("flash");
    router.replace(path + (next.size ? `?${next}` : ""), { scroll: false });
  };
  return (
    <div role="status" className="mb-4 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><span className="flex-1">{shown}</span>
      <button onClick={close} aria-label="ปิดข้อความ" className="rounded p-0.5 hover:bg-emerald-100"><X className="h-4 w-4" /></button>
    </div>
  );
}

export function flashUrl(message: string) {
  const u = new URL(window.location.href);
  u.searchParams.set("flash", message);
  return u.pathname + u.search;
}
