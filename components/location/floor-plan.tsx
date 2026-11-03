import clsx from "clsx";
import { PIN_TONE_LABELS, type PinTone } from "@/lib/location";

export interface PlanPin {
  id: string; x: number; y: number; tone: PinTone; label: string; href?: string; highlight?: boolean;
  /** สัญลักษณ์บนหมุด (นอกจากสี) เช่น "!" "✓" — ช่วยผู้ที่แยกสีไม่ได้ */
  glyph?: string;
}

const TONE: Record<PinTone, string> = {
  danger: "bg-red-600 text-white ring-red-200",
  warning: "bg-amber-500 text-white ring-amber-200",
  ok: "bg-emerald-600 text-white ring-emerald-200",
  muted: "bg-gray-400 text-white ring-gray-200",
  finding: "bg-fuchsia-600 text-white ring-fuchsia-200",
};
export const TONE_GLYPH: Record<PinTone, string> = { danger: "!", warning: "•", ok: "✓", muted: "–", finding: "✕" };

/**
 * แสดงผังชั้นพร้อมหมุด (ตำแหน่งเป็นร้อยละของภาพ จึงแสดงถูกต้องทุกขนาดจอ)
 * ไม่มีภาพผัง → แสดงตารางอ้างอิง 10×10 เพื่อให้หมุดยังสื่อตำแหน่งโดยประมาณได้
 */
export function FloorPlan({ planUrl, pins = [], caption, className, compact }: {
  planUrl: string | null; pins?: PlanPin[]; caption?: string; className?: string; compact?: boolean;
}) {
  return (
    <figure className={clsx("w-full", className)}>
      <div className={clsx("relative w-full overflow-hidden rounded-lg border border-gray-200 bg-white", !planUrl && "aspect-[16/10]")}
        data-testid="floor-plan">
        {planUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={planUrl} alt={caption ?? "ผังชั้น"} className="block h-auto w-full select-none" draggable={false} />
        ) : (
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#e5e7eb_1px,transparent_1px),linear-gradient(to_bottom,#e5e7eb_1px,transparent_1px)] bg-[size:10%_10%]">
            <span className="absolute bottom-1 right-2 text-[10px] text-gray-400">ยังไม่มีภาพผังชั้น — ตารางอ้างอิง</span>
          </div>
        )}
        {pins.map((p) => {
          const glyph = p.glyph ?? TONE_GLYPH[p.tone];
          const cls = clsx("absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full font-bold shadow ring-2 ring-white",
            compact ? "h-4 w-4 text-[9px]" : "h-6 w-6 text-xs", TONE[p.tone],
            p.highlight && "z-10 scale-125 ring-4 animate-pulse", p.tone === "finding" && "rounded-sm");
          const style = { left: `${p.x}%`, top: `${p.y}%` };
          const title = `${p.label} — ${PIN_TONE_LABELS[p.tone]}`;
          return p.href
            ? <a key={p.id} href={p.href} className={cls} style={style} title={title} aria-label={title} data-pin={p.id}>{glyph}</a>
            : <span key={p.id} className={cls} style={style} title={title} aria-label={title} data-pin={p.id}>{glyph}</span>;
        })}
      </div>
      {caption && <figcaption className="mt-1 text-xs text-gray-500">{caption}</figcaption>}
    </figure>
  );
}

export function PinLegend({ tones = ["danger", "warning", "ok", "muted", "finding"] }: { tones?: PinTone[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600" aria-label="ความหมายของหมุด">
      {tones.map((t) => (
        <li key={t} className="flex items-center gap-1.5">
          <span className={clsx("flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold ring-2 ring-white", TONE[t], t === "finding" && "rounded-sm")}>{TONE_GLYPH[t]}</span>
          {PIN_TONE_LABELS[t]}
        </li>
      ))}
    </ul>
  );
}
