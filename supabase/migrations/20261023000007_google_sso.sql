-- =====================================================================
-- เข้าสู่ระบบด้วยบัญชี Google ของมหาวิทยาลัย — จำกัดเฉพาะโดเมนที่อนุญาต (ค่าเริ่มต้น nu.ac.th)
-- ป้องกัน 3 ชั้น:
--   1) ปุ่ม Google ส่ง hd=nu.ac.th (เป็นเพียงคำแนะนำให้ Google แสดงบัญชีมหาวิทยาลัย)
--   2) ฐานข้อมูลปฏิเสธการสร้าง/เชื่อมบัญชีจากผู้ให้บริการภายนอกที่อีเมลไม่อยู่ในโดเมนที่อนุญาต (trigger นี้)
--   3) /auth/callback ตรวจซ้ำและออกจากระบบทันทีหากไม่ผ่าน
-- และแม้ผ่านทั้งหมด ผู้ใช้ใหม่จะยังไม่เห็นข้อมูลใดจนกว่าผู้ดูแลกำหนดบทบาทให้ (RLS)
-- =====================================================================

alter table public.app_settings
  add column if not exists allowed_email_domains text[] not null default '{nu.ac.th}'
  check (cardinality(allowed_email_domains) >= 1);

create or replace function app.email_domain_allowed(p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select lower(split_part(coalesce(p_email, ''), '@', 2)) = any(select lower(trim(d)) from unnest(s.allowed_email_domains) d)
      from public.app_settings s where s.id = 1), false)
$$;

create or replace function public.email_domain_allowed(p_email text) returns boolean
language sql stable security definer set search_path = public as $$ select app.email_domain_allowed(p_email) $$;
revoke execute on function public.email_domain_allowed(text) from public, anon;
grant execute on function public.email_domain_allowed(text) to authenticated, service_role;

-- ตรวจทุกครั้งที่มีการสร้าง/เชื่อมตัวตนจากผู้ให้บริการภายนอก (Google ฯลฯ)
create or replace function app.guard_external_identity() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_email text; v_hd text; v_verified text;
begin
  if new.provider in ('email', 'phone') then return new; end if;
  v_email := lower(coalesce(new.identity_data->>'email', ''));
  v_hd := lower(nullif(new.identity_data->'custom_claims'->>'hd', ''));
  v_verified := coalesce(new.identity_data->>'email_verified', 'true');
  if not app.email_domain_allowed(v_email) then
    raise exception using errcode = 'P0001', message = 'อนุญาตเฉพาะบัญชีอีเมลของมหาวิทยาลัย', hint = 'DOMAIN_NOT_ALLOWED';
  end if;
  -- บัญชี Google Workspace จะมี hd = โดเมนองค์กร; ถ้ามีต้องตรงกับโดเมนที่อนุญาต
  if v_hd is not null and not app.email_domain_allowed('x@' || v_hd) then
    raise exception using errcode = 'P0001', message = 'อนุญาตเฉพาะบัญชี Google ขององค์กรมหาวิทยาลัย', hint = 'DOMAIN_NOT_ALLOWED';
  end if;
  if v_verified = 'false' then
    raise exception using errcode = 'P0001', message = 'อีเมลยังไม่ได้รับการยืนยัน', hint = 'EMAIL_NOT_VERIFIED';
  end if;
  return new;
end $$;

-- หากแพลตฟอร์มไม่อนุญาตสร้าง trigger บน auth.identities จะแจ้งเตือนแต่ไม่หยุดการติดตั้ง
-- (ยังมีการตรวจที่ /auth/callback และผู้ใช้ที่ไม่มีบทบาทมองไม่เห็นข้อมูลใด)
do $$ begin
  drop trigger if exists nu_guard_external_identity on auth.identities;
  create trigger nu_guard_external_identity before insert or update of identity_data on auth.identities
    for each row execute function app.guard_external_identity();
exception when insufficient_privilege then
  raise warning 'ไม่สามารถสร้าง trigger จำกัดโดเมนบน auth.identities (ไม่มีสิทธิ์) — ระบบยังตรวจโดเมนที่ /auth/callback';
end $$;

-- แจ้งผู้ดูแลส่วนกลางเมื่อมีบุคลากรเข้าสู่ระบบด้วย Google ครั้งแรกและยังไม่มีบทบาท
create or replace function app.notify_new_external_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_root uuid; v_name text;
begin
  if new.provider in ('email', 'phone') then return null; end if;
  if exists (select 1 from public.role_assignments where user_id = new.user_id) then return null; end if;
  select id into v_root from public.organizations where parent_id is null limit 1;
  select coalesce(nullif(full_name, ''), email) into v_name from public.profiles where id = new.user_id;
  perform app.notify_roles('{system_admin,safety_coordinator}', v_root, 'user_pending', 'ผู้ใช้ใหม่รอกำหนดสิทธิ์',
    format('%s (%s) เข้าสู่ระบบด้วยบัญชี Google ครั้งแรก — กรุณากำหนดหน่วยงานและบทบาท', coalesce(v_name, ''), new.identity_data->>'email'),
    '/settings/users?pending=1', 'profile', new.user_id, 'user_pending:' || new.user_id);
  return null;
end $$;

do $$ begin
  drop trigger if exists nu_notify_new_external_user on auth.identities;
  create trigger nu_notify_new_external_user after insert on auth.identities
    for each row execute function app.notify_new_external_user();
exception when insufficient_privilege then
  raise warning 'ไม่สามารถสร้าง trigger แจ้งผู้ใช้ใหม่บน auth.identities (ไม่มีสิทธิ์)';
end $$;

-- ชื่อจากบัญชี Google (full_name / name) สำหรับโปรไฟล์ที่สร้างอัตโนมัติ
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), nullif(new.raw_user_meta_data->>'name', ''),
                                      split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;
