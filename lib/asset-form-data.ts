import "server-only";
import { createClient } from "@/lib/supabase/server";
import { floorPlanUrls, getFilterOptions } from "@/lib/queries";
import type { AssetType, Floor, Location, SessionContext } from "@/lib/types";
import { MANAGER_ROLES } from "@/lib/auth";

export async function assetFormData(s: SessionContext) {
  const supabase = await createClient();
  const [opts, floors, locations, types] = await Promise.all([
    getFilterOptions(),
    supabase.from("floors").select("*").order("level"),
    supabase.from("locations").select("*").eq("is_active", true).order("name"),
    supabase.from("asset_types").select("*").order("name"),
  ]);
  const manageable = opts.orgs.filter((o) => s.roles.some((r) => MANAGER_ROLES.includes(r.role) && o.ancestors.includes(r.organization_id)));
  const fl = (floors.data ?? []) as Floor[];
  const planUrls = await floorPlanUrls(fl.map((f) => f.plan_path));
  return { orgs: manageable, buildings: opts.buildings, people: opts.people, floors: fl, locations: (locations.data ?? []) as Location[], types: (types.data ?? []) as AssetType[], planUrls };
}
