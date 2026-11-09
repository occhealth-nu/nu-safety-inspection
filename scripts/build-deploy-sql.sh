#!/usr/bin/env bash
# รวม supabase/migrations/*.sql เป็นไฟล์เดียว deploy/01_install_database.sql (สำหรับวางใน Supabase SQL Editor)
set -euo pipefail
cd "$(dirname "$0")/.."
{
  echo "-- ====================================================================="
  echo "-- NU Safety Inspection — ติดตั้งฐานข้อมูลทั้งหมด (รวม migrations)"
  echo "-- วิธีใช้: Supabase → SQL Editor → New query → วางทั้งไฟล์ → Run (รันครั้งเดียว)"
  echo "-- ====================================================================="
  for f in supabase/migrations/*.sql; do echo; echo "-- >>>>>>>>>> $(basename "$f") >>>>>>>>>>"; cat "$f"; done
} > deploy/01_install_database.sql
echo "สร้าง deploy/01_install_database.sql แล้ว"
# ไฟล์อัปเกรดระบบเดิม = 05 + 06 (สร้าง 06 ด้วย scripts/build-import-data.py ก่อน)
if [ -f deploy/06_import_nu_data.sql ]; then
  { echo "-- ====================================================================="
    echo "-- NU Safety Inspection — อัปเกรดระบบเดิม (ไม่ลบข้อมูล): ผังชั้น/พิกัด + อาคาร 204 อาคาร + ช่องทาง Google Sheets"
    echo "-- = ไฟล์ 05_upgrade_building_locations.sql + 06_import_nu_data.sql รวมกัน · รันซ้ำได้"
    echo "-- ====================================================================="
    cat deploy/05_upgrade_building_locations.sql; echo; cat deploy/06_import_nu_data.sql; } > deploy/12_upgrade_existing_system.sql
  echo "สร้าง deploy/12_upgrade_existing_system.sql แล้ว"
fi
