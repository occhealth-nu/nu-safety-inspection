"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import jsQR from "jsqr";
import { Camera, CameraOff, Search } from "lucide-react";
import { buttonClass, inputClass } from "@/components/ui";

/** แปลงข้อความใน QR เป็นปลายทาง: รองรับ URL ของระบบ (/q/{token}) หรือรหัสอุปกรณ์ */
function targetFromText(text: string): string {
  const m = /\/q\/([A-Za-z0-9_-]+)/.exec(text);
  if (m) return `/q/${m[1]}`;
  return `/q/lookup?code=${encodeURIComponent(text.trim())}`;
}

export function QrScanner() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        const tick = () => {
          if (stopped) return;
          const canvas = canvasRef.current!;
          if (video.readyState === video.HAVE_ENOUGH_DATA) {
            const w = Math.min(video.videoWidth, 640);
            const h = Math.round((video.videoHeight / video.videoWidth) * w);
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
            ctx.drawImage(video, 0, 0, w, h);
            const img = ctx.getImageData(0, 0, w, h);
            const qr = jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
            if (qr?.data) {
              stopped = true;
              navigator.vibrate?.(80);
              router.push(targetFromText(qr.data));
              return;
            }
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {
        setError(window.isSecureContext
          ? "ไม่สามารถเปิดกล้องได้ กรุณาอนุญาตการใช้กล้องในเบราว์เซอร์ หรือกรอกรหัสจุดตรวจด้านล่าง"
          : "การใช้กล้องต้องเปิดผ่าน HTTPS — กรุณากรอกรหัสจุดตรวจด้านล่างแทน");
        setActive(false);
      }
    })();
    return () => { stopped = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, [active, router]);

  return (
    <div className="space-y-4">
      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-gray-900 sm:aspect-video">
        <video ref={videoRef} className={"h-full w-full object-cover " + (active ? "" : "hidden")} playsInline muted />
        <canvas ref={canvasRef} className="hidden" />
        {active ? <div className="pointer-events-none absolute inset-[18%] rounded-2xl border-4 border-white/80" aria-hidden /> : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-gray-300">
            <Camera className="h-12 w-12" aria-hidden /><p className="text-sm">กดปุ่มด้านล่างเพื่อเปิดกล้อง แล้วหันไปที่ QR Code ของจุดตรวจ</p>
          </div>
        )}
      </div>
      <button type="button" onClick={() => { setError(null); setActive((a) => !a); }} className={buttonClass(active ? "secondary" : "primary", "lg") + " w-full"}>
        {active ? <><CameraOff className="h-5 w-5" />ปิดกล้อง</> : <><Camera className="h-5 w-5" />เปิดกล้องสแกน QR</>}
      </button>
      {error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
      <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) router.push(targetFromText(code)); }} className="flex gap-2">
        <label className="sr-only" htmlFor="asset-code">รหัสจุดตรวจ</label>
        <input id="asset-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="หรือกรอกรหัสจุดตรวจ เช่น FE-EN1-101" className={inputClass + " min-h-[48px]"} />
        <button className={buttonClass("secondary", "lg")} aria-label="ค้นหา"><Search className="h-5 w-5" /></button>
      </form>
    </div>
  );
}
