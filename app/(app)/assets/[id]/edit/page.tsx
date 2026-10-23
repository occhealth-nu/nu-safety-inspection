import { createClient } from "@/lib/supabase/server";
import { requireSession, hasRole, MANAGER_ROLES } from "@/lib/auth";
import { assetFormData } from "@/lib/asset-form-data";
import { AssetForm } from "@/components/asset-form";
import { Card, NoAccess, PageHeader } from "@/components/ui";

export const metadata = { title: "แก้ไขจุดตรวจ" };

export default async function EditAsset({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  const supabase = await createClient();
  const { data: a } = await supabase.from("assets").select("*").eq("id", id).maybeSingle();
  if (!a) return <NoAccess message="ไม่พบจุดตรวจ หรือไม่มีสิทธิ์เข้าถึง" />;
  const d = await assetFormData(s);
  if (!hasRole(s, MANAGER_ROLES) || !d.orgs.some((o) => o.id === a.organization_id)) return <NoAccess message="คุณไม่มีสิทธิ์แก้ไขจุดตรวจของหน่วยงานนี้" />;
  return (<><PageHeader title={`แก้ไข ${a.code}`} back={{ href: `/assets/${id}`, label: "รายละเอียด" }} />
    <Card><AssetForm {...d} initial={a} /></Card></>);
}
