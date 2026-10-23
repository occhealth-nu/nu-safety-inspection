"use client";
import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/** ลงทะเบียน Service Worker (แคชเฉพาะไฟล์หน้าเว็บ — ไม่รองรับส่งผลตรวจแบบ Offline) */
export function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);
  return null;
}

export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return online;
}

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="alert" className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-red-700 px-4 py-2 text-sm font-medium text-white">
      <WifiOff className="h-4 w-4" aria-hidden />
      ไม่มีการเชื่อมต่อเครือข่าย — ข้อมูลที่กรอกจะถูกเก็บเป็นฉบับร่างในเครื่องนี้ และยังไม่ถูกส่งเข้าระบบ
    </div>
  );
}
