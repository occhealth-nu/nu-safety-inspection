#!/usr/bin/env bash
# ชุดติดตั้งฉบับสมบูรณ์ (รวมทุกอย่างไว้ชุดเดียว) — ใช้: bash scripts/build-complete-package.sh <โฟลเดอร์ปลายทาง>
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-dist}"; N="NU-Safety-Complete-v1.0"; P="$OUT/$N"
rm -rf "$P" "$OUT/$N.zip"; mkdir -p "$P/sql/optional_sql_only" "$P/google-sheets" "$P/data"
cp docs/INSTALL_COMPLETE_TH.pdf "$P/0_INSTALL_COMPLETE_TH.pdf"
cp docs/READINESS_REPORT_TH.pdf "$P/0_READINESS_REPORT_TH.pdf"
cp deploy/RESET_delete_all_data.sql      "$P/sql/A1_RESET_delete_all_data.sql"
cp deploy/01_install_database.sql        "$P/sql/A2_install_database.sql"
cp deploy/02_starter_data.sql            "$P/sql/A3_starter_data.sql"
cp deploy/12_upgrade_existing_system.sql "$P/sql/B1_upgrade_existing_system.sql"
cp deploy/08_remove_demo_data.sql        "$P/sql/B2_remove_demo_data.sql"
cp deploy/10_first_admin_google.sql      "$P/sql/C1_first_admin.sql"
cp deploy/11_create_import_key.sql       "$P/sql/C2_create_import_key.sql"
cp deploy/00_check_database.sql          "$P/sql/Z_check_database.sql"
cp deploy/06_import_nu_data.sql          "$P/sql/optional_sql_only/S1_import_units_buildings.sql"
cp deploy/07_ready_public_health.sql     "$P/sql/optional_sql_only/S2_public_health_ready.sql"
cp apps-script/Code.gs apps-script/NU-Safety-Sheets-Template.xlsx docs/APPS_SCRIPT_GUIDE_TH.pdf "$P/google-sheets/"
cp data/nu-buildings.csv data/nu-buildings-changes.csv "$P/data/"
(cd "$P" && find . -type f ! -name SHA256SUMS.txt -exec sha256sum {} + | sort -k2 > SHA256SUMS.txt)
(cd "$OUT" && zip -qr "$N.zip" "$N")
echo "สร้าง $OUT/$N.zip"
