"use client";
import { useRef, useState } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { buttonClass } from "@/components/ui";

export interface UploadedPhoto { id: string; path: string; url: string | null }

/** ย่อภาพก่อนอัปโหลด (ด้านยาวสุด 1600px, JPEG) เพื่อลดเวลาส่งบนมือถือ */
async function compress(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.size < 400_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((res) => canvas.toBlob((b) => res(b ?? file), "image/jpeg", 0.82));
  } catch { return file; }
}

export function PhotoUploader({ entityType, entityId, itemId, kind = "evidence", photos, onChange, disabled, label = "ถ่าย/แนบภาพ" }: {
  entityType: "inspection" | "finding" | "asset"; entityId: string; itemId?: string; kind?: string;
  photos: UploadedPhoto[]; onChange: (p: UploadedPhoto[]) => void; disabled?: boolean; label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    if (!navigator.onLine) { setError("ไม่มีเครือข่าย — ยังอัปโหลดภาพไม่ได้ กรุณาลองใหม่เมื่อเชื่อมต่อแล้ว"); return; }
    setBusy(true); setError(null);
    const added: UploadedPhoto[] = [];
    for (const f of Array.from(files).slice(0, 5)) {
      const blob = await compress(f);
      const fd = new FormData();
      fd.set("file", new File([blob], f.name.replace(/\.\w+$/, "") + (blob.type === "image/jpeg" ? ".jpg" : ""), { type: blob.type || f.type }));
      fd.set("entity_type", entityType); fd.set("entity_id", entityId); fd.set("kind", kind);
      if (itemId) fd.set("item_id", itemId);
      try {
        const r = await fetch("/api/attachments", { method: "POST", body: fd });
        const j = await r.json();
        if (!r.ok || !j.ok) { setError(j.message ?? "อัปโหลดไม่สำเร็จ"); break; }
        added.push({ id: j.id, path: j.path, url: j.url });
      } catch { setError("อัปโหลดไม่สำเร็จ: เชื่อมต่อเซิร์ฟเวอร์ไม่ได้"); break; }
    }
    if (added.length) onChange([...photos, ...added]);
    setBusy(false);
    if (input.current) input.current.value = "";
  }

  async function remove(p: UploadedPhoto) {
    const r = await fetch(`/api/attachments/${p.id}`, { method: "DELETE" }).catch(() => null);
    if (r?.ok) onChange(photos.filter((x) => x.id !== p.id)); else setError("ลบภาพไม่สำเร็จ");
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {photos.map((p) => (
          <div key={p.id} className="relative h-20 w-20 overflow-hidden rounded-lg border border-gray-200 bg-gray-100">
            {p.url ? <a href={p.url} target="_blank" rel="noreferrer">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={p.url} alt="ภาพหลักฐาน" className="h-full w-full object-cover" /></a>
              : <span className="flex h-full items-center justify-center text-xs text-gray-500">ไฟล์แนบ</span>}
            {!disabled && <button type="button" onClick={() => remove(p)} aria-label="ลบภาพ" className="absolute right-0.5 top-0.5 rounded bg-white/90 p-1 text-red-700"><Trash2 className="h-3.5 w-3.5" /></button>}
          </div>
        ))}
        {!disabled && (
          <button type="button" onClick={() => input.current?.click()} disabled={busy}
            className={buttonClass("secondary") + " h-20 w-24 flex-col text-xs"}>
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-6 w-6" />}{busy ? "กำลังอัปโหลด" : label}
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="image/*,application/pdf" capture="environment" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
      {error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}
