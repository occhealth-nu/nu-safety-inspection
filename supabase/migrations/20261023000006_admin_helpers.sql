-- =====================================================================
-- RPC ช่วยงานผู้ดูแล: ตรวจสิทธิ์ก่อนเรียก Auth Admin API ฝั่งเซิร์ฟเวอร์
-- =====================================================================
create or replace function public.i_can_manage_org(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and app.can_manage_org(p_org)
$$;

create or replace function public.i_am_system_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and app.is_system_admin()
$$;

-- ผู้ดูแลหน่วยงานเปิด/ระงับบัญชี และย้ายผู้ใช้ภายในขอบเขตของตน
create or replace function public.set_profile_admin(p_user uuid, p_organization_id uuid, p_is_active boolean,
                                                    p_full_name text default null, p_position text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := app.require_login(); v_old uuid;
begin
  select organization_id into v_old from public.profiles where id = p_user;
  if not found then perform app.fail('NOT_FOUND', 'ไม่พบผู้ใช้'); end if;
  if not app.is_system_admin() then
    if (v_old is not null and not app.can_manage_org(v_old))
       or (p_organization_id is null or not app.can_manage_org(p_organization_id)) then
      perform app.fail('FORBIDDEN', 'ไม่มีสิทธิ์จัดการผู้ใช้นอกหน่วยงานของตน');
    end if;
  end if;
  if p_user = v_me and not p_is_active then perform app.fail('FORBIDDEN', 'ไม่สามารถระงับบัญชีของตนเองได้'); end if;
  update public.profiles set organization_id = p_organization_id, is_active = p_is_active,
         full_name = coalesce(nullif(trim(p_full_name), ''), full_name), position = coalesce(p_position, position)
   where id = p_user;
end $$;

-- ผู้ใช้ที่สร้างใหม่ (ยังไม่มีหน่วยงาน) — กำหนดหน่วยงานครั้งแรกโดยผู้มีสิทธิ์จัดการหน่วยงานปลายทาง
create or replace function public.claim_new_profile(p_user uuid, p_organization_id uuid, p_full_name text, p_position text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := app.require_login();
begin
  if not app.can_manage_org(p_organization_id) then perform app.fail('FORBIDDEN', 'ไม่มีสิทธิ์เพิ่มผู้ใช้ในหน่วยงานนี้'); end if;
  update public.profiles set organization_id = p_organization_id, full_name = coalesce(nullif(trim(p_full_name), ''), full_name), position = p_position
   where id = p_user and organization_id is null and created_at > now() - interval '1 hour';
  if not found then perform app.fail('INVALID_STATE', 'ผู้ใช้นี้ถูกกำหนดหน่วยงานไปแล้ว'); end if;
end $$;

revoke execute on function public.i_can_manage_org(uuid), public.i_am_system_admin(),
  public.set_profile_admin(uuid, uuid, boolean, text, text), public.claim_new_profile(uuid, uuid, text, text) from public, anon;
grant execute on function public.i_can_manage_org(uuid), public.i_am_system_admin(),
  public.set_profile_admin(uuid, uuid, boolean, text, text), public.claim_new_profile(uuid, uuid, text, text) to authenticated;
