/**
 * NU Safety Inspection — จัดการข้อมูลผ่าน Google Sheets (Apps Script)
 *
 * เมนู "NU Safety" ในชีต:
 *   • ตั้งค่าการเชื่อมต่อ / ทดสอบการเชื่อมต่อ
 *   • ส่งข้อมูลเข้าระบบ (หน่วยงาน อาคารและชั้น ห้องและพื้นที่ จุดตรวจ แผนการตรวจ ผู้ใช้งาน) — ผลแต่ละแถวเขียนกลับในคอลัมน์ "สถานะการส่ง"
 *   • ดึงรายงาน (อาคาร ข้อบกพร่องค้าง ผู้ใช้ จุดตรวจ) และตั้งเวลาดึงอัตโนมัติทุกเช้า
 *
 * ความปลอดภัย: ใช้ "รหัสนำเข้า" (nuimp_…) ที่สร้างใน Supabase — ไม่ใช้ Secret key
 * ค่าการเชื่อมต่อเก็บใน Script Properties (ไม่แสดงในชีต) · แชร์ชีตนี้เฉพาะผู้ดูแลระบบ
 */

var NU = {
  VERSION: '1.0',
  STATUS: 'สถานะการส่ง',
  SENT_AT: 'ส่งเมื่อ',
  BATCH: 200,
  // แท็บข้อมูล: ชื่อแท็บ → ชนิดข้อมูลในระบบ + การแปลงคอลัมน์ (หัวคอลัมน์แถวที่ 1)
  SHEETS: [
    { name: 'หน่วยงาน', kind: 'organizations', required: ['รหัส', 'ชื่อหน่วยงาน'],
      map: { code: 'รหัส', name: 'ชื่อหน่วยงาน', type: 'ประเภท (ระบบ)' } },
    { name: 'อาคารและชั้น', kind: 'buildings', required: ['หน่วยงานเจ้าของ', 'รหัสอาคาร', 'ชื่ออาคาร'],
      map: { org: 'หน่วยงานเจ้าของ', code: 'รหัสอาคาร', name: 'ชื่ออาคาร', building_no: 'เลขอาคาร',
             building_type: 'ประเภทอาคาร', floors: 'จำนวนชั้น' } },
    { name: 'ห้องและพื้นที่', kind: 'locations', required: ['รหัสอาคาร', 'ชั้น', 'ชื่อห้อง/พื้นที่'],
      map: { building: 'รหัสอาคาร', floor: 'ชั้น', name: 'ชื่อห้อง/พื้นที่', room_no: 'เลขห้อง', type: 'ประเภทพื้นที่' } },
    { name: 'จุดตรวจ', kind: 'assets', required: ['รหัสจุดตรวจ', 'ชื่อจุดตรวจ', 'ประเภทจุดตรวจ', 'รหัสอาคาร', 'ชั้น'],
      map: { code: 'รหัสจุดตรวจ', name: 'ชื่อจุดตรวจ', type: 'ประเภทจุดตรวจ', building: 'รหัสอาคาร', floor: 'ชั้น',
             location: 'ห้อง/พื้นที่', detail: 'รายละเอียดตำแหน่ง', notes: 'หมายเหตุ' } },
    { name: 'แผนการตรวจ', kind: 'plans', required: ['ชื่อแผน', 'หน่วยงาน', 'ประเภทจุดตรวจ', 'ความถี่'],
      map: { name: 'ชื่อแผน', org: 'หน่วยงาน', type: 'ประเภทจุดตรวจ', frequency: 'ความถี่', due_within_days: 'ต้องเสร็จภายใน (วัน)' } },
    { name: 'ผู้ใช้งาน', kind: 'users', required: ['อีเมล (@nu.ac.th)', 'สังกัด (faculty)', 'บทบาท'],
      map: { email: 'อีเมล (@nu.ac.th)', full_name: 'ชื่อ-นามสกุล', position: 'ตำแหน่ง', faculty: 'สังกัด (faculty)',
             unit: 'หน่วยงานที่ได้รับสิทธิ์ (unit)', role: 'บทบาท' } }
  ],
  REPORTS: {
    buildings: { sheet: 'รายงาน-อาคาร', title: 'สรุปความปลอดภัยรายอาคาร',
      cols: ['หน่วยงานเจ้าของ', 'รหัสอาคาร', 'เลขอาคาร', 'ชื่ออาคาร', 'ประเภทอาคาร', 'จำนวนชั้น', 'ชั้นที่มีผัง', 'มีพิกัด',
             'จุดตรวจ', 'งานตรวจเกินกำหนด', 'ข้อบกพร่องค้าง', 'เร่งด่วนค้าง', 'ตรวจล่าสุด'] },
    findings: { sheet: 'รายงาน-ข้อบกพร่อง', title: 'ข้อบกพร่องที่ยังไม่ปิด',
      cols: ['เลขที่', 'ความเร่งด่วน', 'สถานะ', 'หัวข้อ', 'รหัสจุดตรวจ', 'อาคาร', 'หน่วยงาน', 'ผู้รับผิดชอบ', 'ครบกำหนด',
             'เกินกำหนด', 'ความคืบหน้า (%)', 'พบเมื่อ'] },
    users: { sheet: 'รายงาน-ผู้ใช้', title: 'ผู้ใช้และบทบาทในระบบ',
      cols: ['อีเมล', 'ชื่อ-นามสกุล', 'ตำแหน่ง', 'สังกัด', 'บทบาท', 'สถานะ'] },
    assets: { sheet: 'รายงาน-จุดตรวจ', title: 'ทะเบียนจุดตรวจ',
      cols: ['รหัสจุดตรวจ', 'ชื่อ', 'ประเภท', 'อาคาร', 'ชั้น', 'ห้อง/พื้นที่', 'สถานะ', 'ตรวจครั้งถัดไป', 'ปักหมุดบนผัง'] }
  },
  ROLES: {
    'ผู้ดูแลระบบมหาวิทยาลัย': 'system_admin', 'ผู้ประสานงานความปลอดภัยส่วนกลาง': 'safety_coordinator',
    'ผู้ดูแลระดับคณะ/หน่วยงาน': 'org_admin', 'ผู้ตรวจ': 'inspector', 'ผู้รับผิดชอบแก้ไข': 'responsible',
    'ผู้ตรวจยืนยัน': 'verifier', 'ผู้บริหาร/คณะกรรมการความปลอดภัย': 'executive'
  },
  LOCATION_TYPES: { 'ทั่วไป': '', 'พื้นที่ส่วนกลาง': 'common', 'ห้องปฏิบัติการ': 'laboratory', 'ห้องไฟฟ้า': 'electrical', 'ห้องเก็บของ': 'storage' },
  FREQUENCIES: { 'รายวัน': 'daily', 'รายสัปดาห์': 'weekly', 'รายเดือน': 'monthly', 'รายไตรมาส': 'quarterly', 'รายปี': 'yearly' },
  ASSET_TYPES: { 'ถังดับเพลิง': 'FE', 'ตู้สายฉีดน้ำดับเพลิง': 'FH', 'ไฟฉุกเฉิน/ป้ายทางออก': 'EL', 'ทางหนีไฟ/ประตูหนีไฟ': 'EX',
                 'ระบบแจ้งเหตุเพลิงไหม้': 'FA', 'ตู้ไฟ/เต้ารับ/ปลั๊กพ่วง': 'EE', 'พื้นที่ Safety Patrol': 'SP', 'ห้องปฏิบัติการ/ที่เก็บสารเคมี': 'LAB' },
  ORG_TYPES: { 'คณะ/วิทยาลัย': 'faculty', 'กอง/สำนักงาน': 'office', 'ศูนย์/สถาบัน/สำนัก': 'center', 'หน่วยงานย่อย/โรงเรียน': 'unit' },
  SEVERITY: { low: 'ต่ำ', medium: 'ปานกลาง', high: 'สูง', critical: 'วิกฤต' },
  FINDING_STATUS: { open: 'เปิด', assigned: 'มอบหมายแล้ว', in_progress: 'กำลังแก้ไข', pending_verification: 'รอตรวจยืนยัน', closed: 'ปิดแล้ว' }
};

// ------------------------------------------------------------------ เมนู
function onOpen() {
  SpreadsheetApp.getUi().createMenu('NU Safety')
    .addItem('🔌 ตั้งค่าการเชื่อมต่อ', 'setupConnection')
    .addItem('✅ ทดสอบการเชื่อมต่อ', 'testConnection')
    .addSeparator()
    .addItem('⬆️ ส่งแท็บนี้ (เฉพาะแถวใหม่/ที่แก้ไข)', 'sendActiveSheetPending')
    .addItem('⬆️ ส่งแท็บนี้ทั้งหมด', 'sendActiveSheetAll')
    .addItem('⬆️ ส่งทุกแท็บ (เฉพาะแถวใหม่/ที่แก้ไข)', 'sendAllPending')
    .addSeparator()
    .addSubMenu(SpreadsheetApp.getUi().createMenu('⬇️ ดึงรายงาน')
      .addItem('สรุปรายอาคาร', 'exportBuildings')
      .addItem('ข้อบกพร่องที่ยังไม่ปิด', 'exportFindings')
      .addItem('ผู้ใช้และบทบาท', 'exportUsers')
      .addItem('ทะเบียนจุดตรวจ', 'exportAssets')
      .addItem('ทั้งหมด', 'exportAll'))
    .addItem('⏰ ดึงรายงานอัตโนมัติทุกเช้า (07:00)', 'enableDailyExport')
    .addItem('⏹ ยกเลิกการดึงอัตโนมัติ', 'disableDailyExport')
    .addSeparator()
    .addItem('🗑 ลบการตั้งค่าการเชื่อมต่อ', 'clearConnection')
    .addToUi();
}

/** แก้ข้อมูลในแถว → ทำเครื่องหมายว่ารอส่ง (simple trigger) */
function onEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  var def = sheetDef_(sh.getName());
  if (!def || e.range.getRow() < 2) return;
  var header = headerOf_(sh);
  var statusCol = header.indexOf(NU.STATUS) + 1;
  if (statusCol < 1) return;
  var c1 = e.range.getColumn(), c2 = c1 + e.range.getNumColumns() - 1;
  if (statusCol >= c1 && statusCol <= c2 && e.range.getNumColumns() === 1) return;   // แก้ช่องสถานะเอง
  var n = e.range.getNumRows();
  var marks = [];
  for (var i = 0; i < n; i++) marks.push(['✏️ แก้ไขแล้ว — รอส่ง']);
  sh.getRange(e.range.getRow(), statusCol, n, 1).setValues(marks);
}

// ------------------------------------------------------------------ การเชื่อมต่อ
function setupConnection() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var url = ui.prompt('ตั้งค่าการเชื่อมต่อ (1/3)', 'Project URL ของ Supabase เช่น https://abcdxyz.supabase.co\n' +
    '(Supabase → Project Settings → Data API หรือปุ่ม Connect)', ui.ButtonSet.OK_CANCEL);
  if (url.getSelectedButton() !== ui.Button.OK) return;
  var anon = ui.prompt('ตั้งค่าการเชื่อมต่อ (2/3)', 'Publishable key (sb_publishable_…) หรือ anon public key\n' +
    '(Supabase → Project Settings → API Keys) — ห้ามใช้ Secret key', ui.ButtonSet.OK_CANCEL);
  if (anon.getSelectedButton() !== ui.Button.OK) return;
  var key = ui.prompt('ตั้งค่าการเชื่อมต่อ (3/3)', 'รหัสนำเข้า (nuimp_…) ที่ได้จากการรันไฟล์ 8_create_import_key.sql', ui.ButtonSet.OK_CANCEL);
  if (key.getSelectedButton() !== ui.Button.OK) return;
  var cfg = { url: clean_(url.getResponseText()).replace(/\/+$/, ''), anon: clean_(anon.getResponseText()), key: clean_(key.getResponseText()) };
  var err = validateConfig_(cfg);
  if (err) { ui.alert('❌ ' + err); return; }
  props.setProperties({ NU_URL: cfg.url, NU_ANON: cfg.anon, NU_KEY: cfg.key });
  testConnection();
}

function validateConfig_(cfg) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(cfg.url) && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(cfg.url))
    return 'Project URL ต้องเป็นรูปแบบ https://xxxx.supabase.co';
  if (/^sb_secret_/.test(cfg.anon)) return 'ใส่ Secret key ผิดช่อง — ต้องใช้ Publishable key (sb_publishable_…) และควรสร้าง Secret key ใหม่ทันทีเพราะอาจรั่ว';
  if (!/^(sb_publishable_[\w-]+|eyJ[\w-]+\.[\w-]+\.[\w-]+)$/.test(cfg.anon)) return 'Publishable key ไม่ถูกต้อง';
  if (!/^nuimp_[0-9a-f]{48}$/.test(cfg.key)) return 'รหัสนำเข้าต้องขึ้นต้นด้วย nuimp_ และยาว 54 ตัวอักษร';
  return '';
}

function config_() {
  var p = PropertiesService.getScriptProperties().getProperties();
  if (!p.NU_URL || !p.NU_ANON || !p.NU_KEY) throw new Error('ยังไม่ได้ตั้งค่าการเชื่อมต่อ — เมนู NU Safety › ตั้งค่าการเชื่อมต่อ');
  return { url: p.NU_URL, anon: p.NU_ANON, key: p.NU_KEY };
}

function clearConnection() {
  PropertiesService.getScriptProperties().deleteAllProperties();
  SpreadsheetApp.getUi().alert('ลบการตั้งค่าการเชื่อมต่อแล้ว');
}

function testConnection() {
  try {
    var r = rpc_('sheet_ping', {});
    SpreadsheetApp.getUi().alert('✅ เชื่อมต่อสำเร็จ\n\nหน่วยงาน ' + r.organizations + ' · อาคาร ' + r.buildings +
      ' · จุดตรวจ ' + r.assets + ' · ผู้ใช้ ' + r.users + '\n\nโปรเจกต์: ' + config_().url);
  } catch (e) { SpreadsheetApp.getUi().alert('❌ เชื่อมต่อไม่สำเร็จ\n\n' + e.message); }
}

/** เรียกฟังก์ชันในฐานข้อมูลผ่าน Supabase REST (PostgREST) */
function rpc_(fn, body) {
  var cfg = config_();
  body.p_key = cfg.key;
  var headers = { apikey: cfg.anon };
  if (/^eyJ/.test(cfg.anon)) headers.Authorization = 'Bearer ' + cfg.anon;   // anon key แบบเดิม
  var res;
  try {
    res = UrlFetchApp.fetch(cfg.url + '/rest/v1/rpc/' + fn, {
      method: 'post', contentType: 'application/json', headers: headers,
      payload: JSON.stringify(body), muteHttpExceptions: true
    });
  } catch (e) {
    throw new Error('ติดต่อ Supabase ไม่ได้: ' + e.message + '\n(ถ้าใช้บัญชีมหาวิทยาลัย อาจถูกปิดการเชื่อมต่อภายนอกจาก Apps Script — ติดต่อผู้ดูแล Google Workspace)');
  }
  var code = res.getResponseCode(), text = res.getContentText();
  var json = null;
  try { json = JSON.parse(text); } catch (ignore) { /* ไม่ใช่ JSON */ }
  if (code >= 200 && code < 300) return json;
  var msg = (json && json.message) || text || ('HTTP ' + code);
  if (code === 404 || (json && json.code === 'PGRST202'))
    msg = 'ฐานข้อมูลยังไม่มีช่องทางนำเข้าจาก Google Sheets — รันไฟล์ติดตั้งให้ครบ (ฉบับที่มี sheet_import) แล้วรอ 1 นาที';
  if (code === 401) msg = 'Publishable key ไม่ถูกต้องสำหรับโปรเจกต์นี้ — ตรวจว่า URL และ key มาจากโปรเจกต์เดียวกัน';
  throw new Error(msg);
}

// ------------------------------------------------------------------ ส่งข้อมูล
function sendActiveSheetPending() { sendSheetUi_(SpreadsheetApp.getActiveSheet(), true); }
function sendActiveSheetAll() { sendSheetUi_(SpreadsheetApp.getActiveSheet(), false); }

function sendAllPending() {
  var ss = SpreadsheetApp.getActive(), lines = [], totalErr = 0;
  try {
    NU.SHEETS.forEach(function (def) {     // ลำดับสำคัญ: หน่วยงาน → อาคาร → ห้อง → จุดตรวจ → แผน → ผู้ใช้
      var sh = ss.getSheetByName(def.name);
      if (!sh) return;
      var r = sendSheet_(sh, def, true);
      totalErr += r.error;
      lines.push((r.error ? '⚠️ ' : '✅ ') + def.name + ': สำเร็จ ' + r.ok + ' · ไม่สำเร็จ ' + r.error + (r.skipped ? ' · ข้าม ' + r.skipped : ''));
    });
  } catch (e) { SpreadsheetApp.getUi().alert('❌ ' + e.message); return; }
  SpreadsheetApp.getUi().alert('ผลการส่งทุกแท็บ\n\n' + lines.join('\n') +
    (totalErr ? '\n\nดูเหตุผลในคอลัมน์ "' + NU.STATUS + '" ของแถวที่มี ❌ แล้วแก้ไขและส่งใหม่' : ''));
}

function sendSheetUi_(sh, pendingOnly) {
  var def = sheetDef_(sh.getName());
  var ui = SpreadsheetApp.getUi();
  if (!def) { ui.alert('แท็บ "' + sh.getName() + '" ไม่ใช่แท็บข้อมูล — เลือกแท็บ: ' + NU.SHEETS.map(function (d) { return d.name; }).join(', ')); return; }
  try {
    var r = sendSheet_(sh, def, pendingOnly);
    ui.alert((r.error ? '⚠️' : '✅') + ' ส่งแท็บ ' + def.name + '\n\nสำเร็จ ' + r.ok + ' แถว · ไม่สำเร็จ ' + r.error + ' แถว' +
      (r.skipped ? ' · ข้าม ' + r.skipped + ' แถว (ข้อมูลไม่ครบ)' : '') +
      (r.ok + r.error === 0 ? '\n\nไม่มีแถวใหม่หรือแถวที่แก้ไข — ใช้ "ส่งแท็บนี้ทั้งหมด" ถ้าต้องการส่งซ้ำ' : '') +
      (r.error ? '\n\nดูเหตุผลในคอลัมน์ "' + NU.STATUS + '"' : ''));
  } catch (e) { ui.alert('❌ ' + e.message); }
}

/** ส่งแถวของแท็บเป็นชุด แล้วเขียนผลกลับรายแถว — คืน {ok, error, skipped} */
function sendSheet_(sh, def, pendingOnly) {
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return { ok: 0, error: 0, skipped: 0 };
  var header = values[0].map(function (h) { return String(h).trim(); });
  var col = {}; header.forEach(function (h, i) { col[h] = i; });
  var missing = def.required.concat([NU.STATUS]).filter(function (h) { return !(h in col); });
  if (missing.length) throw new Error('แท็บ ' + def.name + ' ไม่มีคอลัมน์: ' + missing.join(', ') + ' (อย่าเปลี่ยนชื่อหัวคอลัมน์แถวที่ 1)');
  var rows = [], skipped = 0, statusUpdates = {};
  for (var i = 1; i < values.length; i++) {
    var v = values[i];
    var status = String(v[col[NU.STATUS]] || '');
    var filled = def.required.every(function (h) { return String(v[col[h]]).trim() !== ''; });
    var any = Object.keys(def.map).some(function (k) { var h = def.map[k]; return h in col && String(v[col[h]]).trim() !== ''; });
    if (!any) continue;                                         // แถวว่าง / แถวช่องผู้ใช้ที่ยังไม่กรอก
    if (pendingOnly && /^✅/.test(status)) continue;
    if (!filled) {
      if (def.kind === 'users' && String(v[col['อีเมล (@nu.ac.th)']]).trim() === '') continue;   // ช่องที่เตรียมไว้ ยังไม่มีคน
      skipped++; statusUpdates[i + 1] = '⚠️ ข้อมูลไม่ครบ: ' + def.required.filter(function (h) { return String(v[col[h]]).trim() === ''; }).join(', ');
      continue;
    }
    var row = { row: i + 1 };
    Object.keys(def.map).forEach(function (k) {
      var h = def.map[k];
      row[k] = h in col ? convert_(def.kind, k, v[col[h]]) : '';
    });
    rows.push(row);
  }
  var ok = 0, error = 0;
  for (var s = 0; s < rows.length; s += NU.BATCH) {
    var res = rpc_('sheet_import', { p_kind: def.kind, p_rows: rows.slice(s, s + NU.BATCH) });
    (res.results || []).forEach(function (x) {
      statusUpdates[x.row] = (x.ok ? '✅ ' : '❌ ') + x.message;
      if (x.ok) ok++; else error++;
    });
  }
  writeStatus_(sh, header, statusUpdates, values);
  return { ok: ok, error: error, skipped: skipped };
}

function convert_(kind, key, v) {
  var s = v instanceof Date ? Utilities.formatDate(v, 'Asia/Bangkok', 'yyyy-MM-dd') : String(v === null || v === undefined ? '' : v).trim();
  if (kind === 'users' && key === 'role') return NU.ROLES[s] || s;
  if (kind === 'users' && key === 'email') return s.toLowerCase();
  if (kind === 'locations' && key === 'type') return s in NU.LOCATION_TYPES ? NU.LOCATION_TYPES[s] : s;
  if (kind === 'organizations' && key === 'type') return NU.ORG_TYPES[s] || s;
  if (key === 'type' && (kind === 'assets' || kind === 'plans')) return NU.ASSET_TYPES[s] || s.toUpperCase();
  if (kind === 'plans' && key === 'frequency') return NU.FREQUENCIES[s] || s;
  if (kind === 'plans' && key === 'due_within_days' && s !== '') return s.replace(/[^0-9]/g, '') || s;
  if ((key === 'floors' || key === 'building_no') && s !== '') return s.replace(/[^0-9]/g, '') || s;
  return s;
}

/** เขียนสถานะทั้งคอลัมน์ในครั้งเดียว (เร็วกว่าเขียนทีละช่องมาก) */
function writeStatus_(sh, header, updates, values) {
  var rows = Object.keys(updates);
  if (!rows.length) return;
  var sIdx = header.indexOf(NU.STATUS), tIdx = header.indexOf(NU.SENT_AT);
  var stamp = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm');
  var n = values.length - 1;
  var st = [], tm = [];
  for (var i = 1; i < values.length; i++) {
    var u = updates[i + 1];
    st.push([u !== undefined ? u : values[i][sIdx]]);
    if (tIdx >= 0) tm.push([u !== undefined ? stamp : values[i][tIdx]]);
  }
  sh.getRange(2, sIdx + 1, n, 1).setValues(st);
  if (tIdx >= 0) sh.getRange(2, tIdx + 1, n, 1).setValues(tm);
}

// ------------------------------------------------------------------ รายงาน
function exportBuildings() { exportUi_('buildings'); }
function exportFindings() { exportUi_('findings'); }
function exportUsers() { exportUi_('users'); }
function exportAssets() { exportUi_('assets'); }
function exportAll() {
  try {
    var n = Object.keys(NU.REPORTS).map(function (k) { return NU.REPORTS[k].sheet + ' ' + exportReport_(k) + ' แถว'; });
    SpreadsheetApp.getUi().alert('✅ ดึงรายงานแล้ว\n\n' + n.join('\n'));
  } catch (e) { SpreadsheetApp.getUi().alert('❌ ' + e.message); }
}
function exportUi_(kind) {
  try { var n = exportReport_(kind); SpreadsheetApp.getUi().alert('✅ ดึงรายงาน "' + NU.REPORTS[kind].title + '" แล้ว ' + n + ' แถว'); }
  catch (e) { SpreadsheetApp.getUi().alert('❌ ' + e.message); }
}

/** เขียนรายงานลงแท็บ (สร้างแท็บให้ถ้ายังไม่มี) — คืนจำนวนแถว */
function exportReport_(kind) {
  var rep = NU.REPORTS[kind];
  var res = rpc_('sheet_export', { p_kind: kind });
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(rep.sheet) || ss.insertSheet(rep.sheet);
  sh.clear();
  var data = (res.rows || []).map(function (o) {
    return rep.cols.map(function (c) {
      var v = o[c];
      if (kind === 'findings' && c === 'ความเร่งด่วน') v = NU.SEVERITY[v] || v;
      if (kind === 'findings' && c === 'สถานะ') v = NU.FINDING_STATUS[v] || v;
      return v === null || v === undefined ? '' : v;
    });
  });
  sh.getRange(1, 1).setValue(rep.title + ' — ข้อมูล ณ ' + res.generated_at + ' (อ่านอย่างเดียว: ดึงใหม่จะเขียนทับ)');
  sh.getRange(2, 1, 1, rep.cols.length).setValues([rep.cols]).setFontWeight('bold').setBackground('#F26F21').setFontColor('#FFFFFF');
  if (data.length) sh.getRange(3, 1, data.length, rep.cols.length).setValues(data);
  sh.setFrozenRows(2);
  return data.length;
}

function dailyExport() { Object.keys(NU.REPORTS).forEach(function (k) { exportReport_(k); }); }

function enableDailyExport() {
  disableDailyExport(true);
  ScriptApp.newTrigger('dailyExport').timeBased().everyDays(1).atHour(7).inTimezone('Asia/Bangkok').create();
  SpreadsheetApp.getUi().alert('⏰ ตั้งดึงรายงานอัตโนมัติทุกวันเวลาประมาณ 07:00 แล้ว');
}
function disableDailyExport(silent) {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'dailyExport') ScriptApp.deleteTrigger(t); });
  if (silent !== true) SpreadsheetApp.getUi().alert('ยกเลิกการดึงรายงานอัตโนมัติแล้ว');
}

// ------------------------------------------------------------------ ตัวช่วย
function sheetDef_(name) { for (var i = 0; i < NU.SHEETS.length; i++) if (NU.SHEETS[i].name === name) return NU.SHEETS[i]; return null; }
function headerOf_(sh) { return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); }); }
function clean_(s) { return String(s || '').replace(/\s+/g, '').replace(/^["']|["']$/g, ''); }
