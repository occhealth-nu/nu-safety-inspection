-- =====================================================================
-- Storage: bucket "attachments" แบบ private (เข้าถึงผ่าน signed URL อายุจำกัดเท่านั้น)
-- โครงสร้าง path: {entity_type}/{entity_id}/{uuid}.{ext}
-- bucket "branding" แบบ public สำหรับตรามหาวิทยาลัยที่ผู้ดูแลอัปโหลด (ไม่ใช่ข้อมูลลับ)
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public = false;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', true, 2097152, array['image/png','image/svg+xml','image/webp','image/jpeg'])
on conflict (id) do nothing;

create or replace function app.storage_path_parts(p_name text, out entity_type text, out entity_id uuid)
language plpgsql immutable as $$
declare parts text[] := string_to_array(p_name, '/');
begin
  entity_type := parts[1];
  begin
    entity_id := parts[2]::uuid;
  exception when others then
    entity_id := null;
  end;
end $$;

create or replace function app.storage_can_read(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v record;
begin
  v := app.storage_path_parts(p_name);
  if v.entity_id is null then return false; end if;
  return app.can_view_attachment(v.entity_type, v.entity_id);
end $$;

create or replace function app.storage_can_upload(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v record;
begin
  v := app.storage_path_parts(p_name);
  if v.entity_id is null or p_name like '%..%' then return false; end if;
  perform app.attachment_target(v.entity_type, v.entity_id,
    case v.entity_type when 'inspection' then 'evidence' when 'finding' then 'after' else 'photo' end, true);
  return true;
exception when others then
  return false;
end $$;

grant execute on function app.storage_path_parts(text), app.storage_can_read(text), app.storage_can_upload(text) to authenticated;

drop policy if exists "nu_attachments_read" on storage.objects;
drop policy if exists "nu_attachments_insert" on storage.objects;
drop policy if exists "nu_attachments_delete" on storage.objects;
drop policy if exists "nu_branding_write" on storage.objects;

create policy "nu_attachments_read" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and app.storage_can_read(name));
create policy "nu_attachments_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and app.storage_can_upload(name));
-- ลบได้เฉพาะไฟล์ของตนที่ไม่มีการอ้างอิงในตาราง attachments แล้ว (ลบผ่าน remove_attachment ก่อน)
create policy "nu_attachments_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and owner_id = (select auth.uid())::text
         and not exists (select 1 from public.attachments a where a.storage_path = name));
create policy "nu_branding_write" on storage.objects for all to authenticated
  using (bucket_id = 'branding' and app.is_system_admin())
  with check (bucket_id = 'branding' and app.is_system_admin());
