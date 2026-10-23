import Link from "next/link";
import clsx from "clsx";
import {
  AlertTriangle, Ban, CheckCircle2, CircleDashed, Clock, Info, Loader2, Lock, MinusCircle, ShieldAlert, XCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Tone } from "@/lib/labels";

export function PageHeader({ title, subtitle, actions, back }: { title: string; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && <Link href={back.href} className="mb-1 inline-block text-sm text-gray-500 hover:text-brand">‹ {back.label}</Link>}
        <h1 className="text-xl font-bold text-ink sm:text-2xl">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-gray-600">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 print:hidden">{actions}</div>}
    </div>
  );
}

export function Card({ children, className, title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={clsx("rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5", className)}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold text-ink">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

const toneClass: Record<Tone, string> = {
  neutral: "bg-gray-100 text-gray-700 ring-gray-300",
  info: "bg-sky-50 text-sky-800 ring-sky-300",
  good: "bg-emerald-50 text-emerald-800 ring-emerald-300",
  warning: "bg-amber-50 text-amber-900 ring-amber-300",
  serious: "bg-orange-50 text-orange-900 ring-orange-300",
  critical: "bg-red-50 text-red-800 ring-red-300",
};
const toneIcon: Record<Tone, typeof Info> = {
  neutral: CircleDashed, info: Clock, good: CheckCircle2, warning: AlertTriangle, serious: ShieldAlert, critical: XCircle,
};

/** ป้ายสถานะ: ข้อความ + ไอคอน + สี (ไม่พึ่งสีอย่างเดียว) */
export function Badge({ tone = "neutral", children, icon = true, className }: { tone?: Tone; children: ReactNode; icon?: boolean; className?: string }) {
  const Icon = toneIcon[tone];
  return (
    <span className={clsx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", toneClass[tone], className)}>
      {icon && <Icon className="h-3.5 w-3.5" aria-hidden />}
      {children}
    </span>
  );
}

type BtnVariant = "primary" | "secondary" | "danger" | "ghost" | "success";
const btnClass: Record<BtnVariant, string> = {
  primary: "bg-brand text-white hover:bg-brand/90 focus-visible:outline-brand",
  secondary: "bg-white text-ink ring-1 ring-inset ring-gray-300 hover:bg-gray-50",
  danger: "bg-red-600 text-white hover:bg-red-700",
  success: "bg-emerald-600 text-white hover:bg-emerald-700",
  ghost: "text-gray-700 hover:bg-gray-100",
};
export function buttonClass(variant: BtnVariant = "primary", size: "sm" | "md" | "lg" = "md") {
  return clsx(
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
    size === "sm" && "px-3 py-1.5 text-sm",
    size === "md" && "px-4 py-2 text-sm",
    size === "lg" && "min-h-[52px] px-5 py-3 text-base",
    btnClass[variant],
  );
}
export function LinkButton({ href, children, variant = "primary", size = "md", className, prefetch }: { href: string; children: ReactNode; variant?: BtnVariant; size?: "sm" | "md" | "lg"; className?: string; prefetch?: boolean }) {
  return <Link href={href} prefetch={prefetch} className={clsx(buttonClass(variant, size), className)}>{children}</Link>;
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center">
      <div className="mb-2 text-gray-400">{icon ?? <MinusCircle className="h-8 w-8" aria-hidden />}</div>
      <p className="font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-gray-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = "ไม่สามารถโหลดข้อมูลได้", message, retryHref }: { title?: string; message?: string; retryHref?: string }) {
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-900">
      <p className="flex items-center gap-2 font-semibold"><XCircle className="h-5 w-5" aria-hidden />{title}</p>
      {message && <p className="mt-1 text-sm">{message}</p>}
      {retryHref && <Link href={retryHref} className="mt-3 inline-block text-sm font-medium underline">ลองใหม่อีกครั้ง</Link>}
    </div>
  );
}

export function NoAccess({ message = "บัญชีของคุณไม่มีสิทธิ์เข้าถึงข้อมูลนี้ หรือข้อมูลอยู่นอกขอบเขตหน่วยงานของคุณ" }: { message?: string }) {
  return (
    <div role="alert" className="mx-auto max-w-lg rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
      <Lock className="mx-auto mb-3 h-10 w-10 text-gray-400" aria-hidden />
      <h2 className="text-lg font-semibold text-ink">ไม่มีสิทธิ์เข้าถึง</h2>
      <p className="mt-2 text-sm text-gray-600">{message}</p>
      <Link href="/" className={clsx(buttonClass("secondary"), "mt-5")}>กลับหน้าแดชบอร์ด</Link>
    </div>
  );
}

export function NotConnected({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <Ban className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warning" | "success" | "error"; children: ReactNode }) {
  const map = {
    info: "border-sky-200 bg-sky-50 text-sky-900",
    warning: "border-amber-300 bg-amber-50 text-amber-900",
    success: "border-emerald-300 bg-emerald-50 text-emerald-900",
    error: "border-red-300 bg-red-50 text-red-900",
  };
  const Icon = tone === "success" ? CheckCircle2 : tone === "error" ? XCircle : tone === "warning" ? AlertTriangle : Info;
  return (
    <div role={tone === "error" ? "alert" : "status"} className={clsx("flex items-start gap-2 rounded-lg border p-3 text-sm", map[tone])}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><div className="min-w-0">{children}</div>
    </div>
  );
}

export function Spinner({ label = "กำลังโหลด…" }: { label?: string }) {
  return <span className="inline-flex items-center gap-2 text-sm text-gray-500" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />{label}</span>;
}

export function LoadingBlock({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="กำลังโหลดข้อมูล">
      <Spinner />
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-200/70" />)}
    </div>
  );
}

export function Field({ label, children, hint, required, htmlFor }: { label: string; children: ReactNode; hint?: ReactNode; required?: boolean; htmlFor?: string }) {
  return (
    <label className="block" htmlFor={htmlFor}>
      <span className="mb-1 block text-sm font-medium text-gray-800">{label}{required && <span className="text-red-600"> *</span>}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-gray-500">{hint}</span>}
    </label>
  );
}

export const inputClass = "block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-ink shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:bg-gray-100";

export function DemoBadge() {
  return <Badge tone="warning" icon={false}>ข้อมูลตัวอย่าง</Badge>;
}

export function ExpertDraftBadge() {
  return <Badge tone="warning">ร่างสำหรับผู้เชี่ยวชาญตรวจรับรอง</Badge>;
}

export function Table({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white"><table className="min-w-full divide-y divide-gray-200 text-sm">{children}</table></div>;
}
export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th scope="col" className={clsx("whitespace-nowrap bg-gray-50 px-3 py-2 text-left text-xs font-semibold text-gray-600", className)}>{children}</th>;
}
export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={clsx("px-3 py-2 align-top text-gray-800", className)}>{children}</td>;
}
