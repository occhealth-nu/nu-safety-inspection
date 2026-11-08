-- =====================================================================
-- ตรวจสถานะฐานข้อมูล: บอกว่าต้องรันไฟล์ไหนเพิ่ม (อ่านอย่างเดียว ไม่แก้ข้อมูล)
-- วิธีใช้: Supabase → SQL Editor → New query → วางทั้งไฟล์ → Run → อ่านคอลัมน์ "ต้องทำ"
-- =====================================================================
select ลำดับ, รายการ, case when ok then '✅ มีแล้ว' else '❌ ยังไม่มี' end as สถานะ,
       case when ok then '-' else ต้องทำ end as ต้องทำ
from (values
  (1, 'ติดตั้งระบบหลัก (ตาราง organizations)', to_regclass('public.organizations') is not null,
      'รันไฟล์ 01_install_database.sql'),
  (2, 'หน่วยงานราก + แบบตรวจ', exists (select 1 from pg_class where relname = 'organizations') and
      (select count(*) > 0 from public.checklist_templates), 'รันไฟล์ 02_starter_data.sql'),
  (3, 'อัปเกรดอาคาร/ผังชั้น/พิกัด (ฟังก์ชัน building_safety_overview 3 ค่า)',
      to_regprocedure('public.building_safety_overview(date,date,uuid)') is not null,
      'รันไฟล์ 05_upgrade_building_locations.sql'),
  (4, 'คอลัมน์พิกัดอาคาร (buildings.latitude)',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'buildings' and column_name = 'latitude'),
      'รันไฟล์ 05_upgrade_building_locations.sql'),
  (5, 'เครื่องมือนำเข้าผู้ใช้/อาคาร (app.import_user)',
      to_regprocedure('app.import_user(text,text,text,text,text,text)') is not null, 'รันไฟล์ 06_import_nu_data.sql'),
  (6, 'อาคารคณะสาธารณสุขศาสตร์ PH1–PH3',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'buildings' and column_name = 'code')
      and (select count(*) = 3 from public.buildings where code in ('PH1','PH2','PH3')), 'รันไฟล์ 06_import_nu_data.sql'),
  (7, 'ชุดพร้อมใช้ (app.import_plan + จุดตรวจ PH)',
      to_regprocedure('app.import_plan(text,text,text,text,integer,date,text)') is not null, 'รันไฟล์ 07_ready_public_health.sql')
) v(ลำดับ, รายการ, ok, ต้องทำ)
order by ลำดับ;

-- ให้ Supabase API โหลดรายการตาราง/ฟังก์ชันใหม่ (แก้กรณีรันอัปเกรดแล้วแต่หน้าเว็บยังขึ้นข้อผิดพลาด)
notify pgrst, 'reload schema';
