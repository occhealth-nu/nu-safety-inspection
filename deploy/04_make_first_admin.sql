-- =====================================================================
-- ตั้งผู้ดูแลระบบคนแรก
-- 1) สร้างผู้ใช้ก่อนที่ Supabase → Authentication → Users → Add user → Create new user
--    (ใส่อีเมล + รหัสผ่าน และติ๊ก "Auto Confirm User")
-- 2) แก้อีเมลและชื่อในบรรทัดด้านล่าง (2 จุดที่มีคำว่า แก้ตรงนี้) แล้วกด Run
-- =====================================================================
do $$
declare
  v_email text := 'admin@example.ac.th';          -- แก้ตรงนี้: อีเมลที่สร้างในขั้นที่ 1
  v_name  text := 'ชื่อ นามสกุล ผู้ดูแลระบบ';       -- แก้ตรงนี้: ชื่อที่แสดงในระบบ
  v_user uuid; v_root uuid;
begin
  select id into v_root from public.organizations where parent_id is null;
  if v_root is null then raise exception 'ยังไม่มีหน่วยงานราก — กรุณารันไฟล์ 02_starter_data.sql ก่อน'; end if;
  select id into v_user from public.profiles where lower(email) = lower(v_email);
  if v_user is null then raise exception 'ไม่พบผู้ใช้อีเมล % — กรุณาสร้างผู้ใช้ใน Authentication → Users ก่อน', v_email; end if;
  update public.profiles set organization_id = v_root, full_name = v_name, is_active = true where id = v_user;
  insert into public.role_assignments (user_id, role, organization_id) values (v_user, 'system_admin', v_root)
  on conflict do nothing;
  raise notice 'ตั้ง % เป็นผู้ดูแลระบบมหาวิทยาลัยเรียบร้อย', v_email;
end $$;
