import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NoAccess, PageHeader } from "@/components/ui";

export default async function LookupPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code = "" } = await searchParams;
  const clean = code.trim().slice(0, 64);
  if (clean) {
    const supabase = await createClient();
    const { data } = await supabase.from("assets").select("qr_token").or(`code.eq.${clean.replace(/[,()]/g, "")},qr_token.eq.${clean.replace(/[,()]/g, "")}`).maybeSingle();
    if (data) redirect(`/q/${data.qr_token}`);
  }
  return (<><PageHeader title="ค้นหาจุดตรวจ" back={{ href: "/inspect", label: "กลับไปสแกน" }} />
    <NoAccess message={`ไม่พบจุดตรวจรหัส “${clean}” หรือจุดตรวจนี้อยู่นอกขอบเขตสิทธิ์ของคุณ`} /></>);
}
