"use client";
import { Printer } from "lucide-react";
import { buttonClass } from "@/components/ui";

export function PrintButton({ label = "พิมพ์ / บันทึกเป็น PDF" }: { label?: string }) {
  return <button type="button" onClick={() => window.print()} className={buttonClass("primary")}><Printer className="h-4 w-4" />{label}</button>;
}
