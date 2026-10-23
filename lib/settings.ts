import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export interface AppSettings {
  app_name: string; university_name_th: string; university_name_en: string;
  primary_color: string; dark_color: string; logo_url: string | null; sso_note: string | null; allowed_email_domains: string[];
}

const DEFAULTS: AppSettings = {
  app_name: "NU Safety Inspection", university_name_th: "มหาวิทยาลัยนเรศวร", university_name_en: "Naresuan University",
  primary_color: "#F26F21", dark_color: "#2F3337", logo_url: null, sso_note: null, allowed_email_domains: ["nu.ac.th"],
};

export const getAppSettings = cache(async (): Promise<AppSettings> => {
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("app_settings").select("*").eq("id", 1).maybeSingle();
    return { ...DEFAULTS, ...(data ?? {}) };
  } catch {
    return DEFAULTS;
  }
});

export function hexToRgbTriplet(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return "242 111 33";
  return `${parseInt(m[1], 16)} ${parseInt(m[2], 16)} ${parseInt(m[3], 16)}`;
}
