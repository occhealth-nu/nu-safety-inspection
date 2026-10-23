import { requireSession, hasRole, MANAGER_ROLES } from "@/lib/auth";
import { assetFormData } from "@/lib/asset-form-data";
import { AssetForm } from "@/components/asset-form";
import { Card, NoAccess, PageHeader } from "@/components/ui";

export const metadata = { title: "เพิ่มจุดตรวจ" };

export default async function NewAsset() {
  const s = await requireSession();
  if (!hasRole(s, MANAGER_ROLES)) return <NoAccess />;
  const d = await assetFormData(s);
  return (<><PageHeader title="เพิ่มจุดตรวจ/อุปกรณ์" back={{ href: "/assets", label: "ทะเบียนจุดตรวจ" }} />
    <Card><AssetForm {...d} /></Card></>);
}
