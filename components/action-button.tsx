"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";

export type ClientResult<T = unknown> = ActionResult<T> & { redirect?: string };

/** เรียกคำสั่งที่ /api/actions/{name} — ผลลัพธ์มาจาก Backend เสมอ (ไม่เดาว่าสำเร็จ) */
export async function callAction<T = unknown>(name: string, body: FormData | unknown[]): Promise<ClientResult<T>> {
  try {
    const res = await fetch(`/api/actions/${name}`, {
      method: "POST", credentials: "same-origin",
      ...(body instanceof FormData ? { body } : { body: JSON.stringify({ args: body }), headers: { "content-type": "application/json" } }),
    });
    if (res.status === 401) return { ok: false, code: "UNAUTHENTICATED", message: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่ (ข้อมูลยังไม่ถูกบันทึก)" };
    return (await res.json()) as ClientResult<T>;
  } catch {
    return { ok: false, code: "NETWORK", message: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ยังไม่ได้บันทึก กรุณาตรวจสอบเครือข่ายแล้วลองใหม่" };
  }
}

/** แสดงผลใหม่หลังบันทึกสำเร็จ: โหลดหน้าใหม่พร้อมข้อความยืนยัน (ไม่พึ่งการนำทางฝั่ง client) */
export function reloadWithFlash(message?: string, target?: string) {
  const u = new URL(target ?? window.location.href, window.location.origin);
  if (message) u.searchParams.set("flash", message); else u.searchParams.delete("flash");
  window.location.replace(u.pathname + u.search + u.hash);
}

export function ActionButton({ action, args = [], children, variant = "secondary", size = "sm", confirm, className, flash = true }: {
  action: string; args?: unknown[]; children: React.ReactNode; variant?: "primary" | "secondary" | "danger" | "ghost" | "success";
  size?: "sm" | "md" | "lg"; confirm?: string; className?: string; flash?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" disabled={pending} className={buttonClass(variant, size) + " " + (className ?? "")}
        onClick={async () => {
          if (confirm && !window.confirm(confirm)) return;
          setPending(true); setMsg(null);
          const r = await callAction(action, args);
          if (r.ok) { reloadWithFlash(flash ? r.message : undefined, r.redirect); return; }
          setMsg({ ok: false, text: r.message ?? "ไม่สำเร็จ" });
          setPending(false);
        }}>
        {pending ? "กำลังดำเนินการ…" : children}
      </button>
      {msg && <span role="alert" className="text-xs text-red-700">{msg.text}</span>}
    </span>
  );
}

/** ฟอร์มที่ส่งไปยัง /api/actions/{name}: สถานะกำลังบันทึก, ข้อความผิดพลาด และโหลดใหม่เมื่อสำเร็จ */
export function useActionForm<T = unknown>(name: string, opts: { reload?: boolean; onSuccess?: (r: ClientResult<T>) => void } = {}) {
  const [state, setState] = useState<ClientResult<T> | null>(null);
  const [pending, setPending] = useState(false);
  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;               // กันส่งซ้ำ
    const form = e.currentTarget;
    const fd = new FormData(form);
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.name) fd.set(submitter.name, submitter.value);
    setPending(true); setState(null);
    const r = await callAction<T>(name, fd);
    if (r.ok && r.redirect) { window.location.assign(r.redirect); return; }
    if (r.ok && opts.onSuccess) { opts.onSuccess(r); setState(r); setPending(false); return; }
    if (r.ok && opts.reload !== false) { reloadWithFlash(r.message); return; }
    setState(r); setPending(false);
    if (r.ok) form.reset();
  };
  return { state, pending, onSubmit };
}

export function FormMessage({ state }: { state?: ActionResult<unknown> | null }) {
  if (!state?.message) return null;
  return (
    <div role={state.ok ? "status" : "alert"} className={"rounded-lg p-3 text-sm " + (state.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900")}>
      {state.message}
      {state.details && state.details.length > 0 && <ul className="mt-1 list-disc pl-5">{state.details.map((d, i) => <li key={i}>{d.seq ? `ข้อ ${d.seq}: ` : ""}{d.message}</li>)}</ul>}
    </div>
  );
}
