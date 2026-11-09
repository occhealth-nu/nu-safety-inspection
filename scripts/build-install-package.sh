#!/usr/bin/env bash
# รวมชุดติดตั้งใหม่ทั้งหมด (ไฟล์เรียงตามลำดับขั้น) เป็น NU-Safety-Install.zip
# ใช้: bash scripts/build-install-package.sh <โฟลเดอร์ปลายทาง>
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-dist}"; P="$OUT/NU-Safety-Install"
rm -rf "$P" "$OUT/NU-Safety-Install.zip"; mkdir -p "$P/data"
cp docs/INSTALL_FRESH_TH.pdf "$P/0_INSTALL_GUIDE_TH.pdf"
cp docs/INSTALL_FRESH_TH.md  "$P/0_INSTALL_GUIDE_TH.md"
cp deploy/RESET_delete_all_data.sql   "$P/1_RESET_delete_all_data.sql"
cp deploy/01_install_database.sql     "$P/2_install_database.sql"
cp deploy/02_starter_data.sql         "$P/3_starter_data.sql"
cp deploy/06_import_nu_data.sql       "$P/4_import_units_buildings.sql"
cp deploy/07_ready_public_health.sql  "$P/5_public_health_ready.sql"
cp deploy/10_first_admin_google.sql   "$P/6_first_admin.sql"
cp deploy/00_check_database.sql       "$P/7_check_database.sql"
cp "docs/import/แบบฟอร์มนำเข้าข้อมูล-NU-Safety.xlsx" "$P/NU-Safety-Import-Form.xlsx"
cp data/nu-buildings.csv data/nu-buildings-changes.csv "$P/data/"
(cd "$OUT" && zip -qr NU-Safety-Install.zip NU-Safety-Install)
echo "สร้าง $OUT/NU-Safety-Install.zip"
