-- =====================================================================
-- NU Safety Inspection — ลบข้อมูลและโครงสร้างฐานข้อมูลทั้งหมด เพื่อติดตั้งใหม่ (RESET)
--
-- ⚠️ ลบถาวร กู้คืนไม่ได้: หน่วยงาน อาคาร จุดตรวจ ผลตรวจ ข้อบกพร่อง ภาพถ่าย ผังชั้น
--    การตั้งค่า และ "บัญชีผู้ใช้ทุกคน" (รวมผู้ดูแลระบบ) ในโปรเจกต์ Supabase นี้
-- ✅ ไม่ลบ: การตั้งค่า Vercel, การตั้งค่า Google login และ API keys ของ Supabase
--    (จึงไม่ต้องแก้ Vercel — หลังลบให้ติดตั้งใหม่ด้วยไฟล์ขั้นที่ 2 เป็นต้นไปในโปรเจกต์เดียวกัน)
--
-- วิธีใช้: Supabase → SQL Editor → New query → วางทั้งไฟล์
--   → แก้บรรทัดที่มีคำว่า "แก้ตรงนี้" จาก 'ไม่ลบ' เป็น 'ลบทั้งหมด' → Run
--   (ป้องกันการเผลอรัน: ถ้าไม่แก้ ระบบจะหยุดโดยไม่ลบอะไรเลย)
-- =====================================================================
do $$
declare
  v_confirm text := 'ไม่ลบ';    -- แก้ตรงนี้: เปลี่ยนเป็น 'ลบทั้งหมด' เพื่อยืนยัน
  r record;
  n_users int := 0; n_files int := 0; n_objs int := 0;
  v_note text := '';
begin
  if v_confirm <> 'ลบทั้งหมด' then
    raise exception 'ยังไม่ได้ยืนยัน — แก้บรรทัด v_confirm เป็น ''ลบทั้งหมด'' แล้วกด Run อีกครั้ง (ยังไม่มีการลบใด ๆ)';
  end if;

  -- 1) ไฟล์ภาพถ่าย/ผังชั้น/โลโก้ที่อัปโหลด (ถ้า Supabase ไม่อนุญาตให้ลบด้วย SQL ให้ลบในหน้า Storage แทน)
  if to_regclass('storage.objects') is not null then
    begin
      delete from storage.objects where bucket_id in ('attachments', 'floor-plans', 'branding');
      get diagnostics n_files = row_count;
    exception when others then
      v_note := v_note || E'\n  • ไฟล์ใน Storage ลบด้วย SQL ไม่ได้ (' || sqlerrm || E') — ถ้าต้องการลบ: Storage → เปิดแต่ละ bucket → เลือกทั้งหมด → Delete (ไม่ลบก็ไม่กระทบการติดตั้งใหม่)';
    end;
    for r in select policyname from pg_policies
              where schemaname = 'storage' and tablename = 'objects' and policyname like 'nu\_%' loop
      execute format('drop policy if exists %I on storage.objects', r.policyname);
    end loop;
  end if;

  -- 2) trigger ของระบบบนตาราง auth
  drop trigger if exists on_auth_user_created on auth.users;
  drop trigger if exists nu_guard_external_identity on auth.identities;
  drop trigger if exists nu_notify_new_external_user on auth.identities;

  -- 3) ฟังก์ชันภายในของระบบ (schema app)
  drop schema if exists app cascade;

  -- 4) ตาราง/วิว/ฟังก์ชัน/ชนิดข้อมูลทั้งหมดใน schema public (ไม่แตะ extension ของ Supabase)
  for r in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
            where s.nspname = 'public' and c.relkind in ('v', 'm')
              and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e') loop
    execute format('drop view if exists public.%I cascade', r.relname); n_objs := n_objs + 1;
  end loop;
  for r in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
            where s.nspname = 'public' and c.relkind in ('r', 'p')
              and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e') loop
    execute format('drop table if exists public.%I cascade', r.relname); n_objs := n_objs + 1;
  end loop;
  for r in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
            where s.nspname = 'public' and c.relkind = 'S'
              and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e') loop
    execute format('drop sequence if exists public.%I cascade', r.relname); n_objs := n_objs + 1;
  end loop;
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where s.nspname = 'public'
              and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') loop
    execute format('drop function if exists %s cascade', r.sig); n_objs := n_objs + 1;
  end loop;
  for r in select t.typname from pg_type t join pg_namespace s on s.oid = t.typnamespace
            where s.nspname = 'public' and t.typtype in ('e', 'd', 'c')
              and (t.typtype <> 'c' or exists (select 1 from pg_class c where c.oid = t.typrelid and c.relkind = 'c'))
              and not exists (select 1 from pg_depend d where d.objid = t.oid and d.deptype = 'e') loop
    execute format('drop type if exists public.%I cascade', r.typname); n_objs := n_objs + 1;
  end loop;

  -- 5) บัญชีผู้ใช้ทั้งหมด (Authentication → Users) — ลบหลังตารางของระบบ
  delete from auth.users;
  get diagnostics n_users = row_count;

  raise notice E'ลบเรียบร้อย: บัญชีผู้ใช้ % บัญชี · ไฟล์ % ไฟล์ · โครงสร้างฐานข้อมูล % รายการ%\nขั้นต่อไป: รันไฟล์ขั้นที่ 2 (ติดตั้งฐานข้อมูล) ในโปรเจกต์นี้',
    n_users, n_files, n_objs, v_note;
end $$;

-- ตรวจผล: ทุกช่องต้องเป็น 0 (หรือ false)
select (select count(*) from pg_class c join pg_namespace s on s.oid = c.relnamespace
         where s.nspname = 'public' and c.relkind in ('r', 'S', 'v')) as ตารางที่เหลือ,
       (select count(*) from auth.users) as บัญชีผู้ใช้ที่เหลือ,
       exists (select 1 from pg_namespace where nspname = 'app') as ยังมีschema_app;

notify pgrst, 'reload schema';
