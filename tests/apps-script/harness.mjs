// ทดสอบ apps-script/Code.gs แบบไม่ต้องใช้ Google: จำลอง SpreadsheetApp/PropertiesService/UrlFetchApp
// แต่เรียก Supabase REST (PostgREST) จริงของ stack ทดสอบ — ใช้: node tests/apps-script/harness.mjs <template.xlsx> <url> <anon> <key>
import fs from "node:fs";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import ExcelJS from "exceljs";

const [, , xlsx, URL_, ANON, KEY] = process.argv;
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(xlsx);

// ---------- Spreadsheet mock ----------
class Range {
  constructor(sh, r, c, nr = 1, nc = 1) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValues() { return Array.from({ length: this.nr }, (_, i) => Array.from({ length: this.nc }, (_, j) => this.sh.get(this.r + i, this.c + j))); }
  setValues(v) { v.forEach((row, i) => row.forEach((x, j) => this.sh.set(this.r + i, this.c + j, x))); return this; }
  setValue(x) { this.sh.set(this.r, this.c, x); return this; }
  setFontWeight() { return this; } setBackground() { return this; } setFontColor() { return this; }
  getRow() { return this.r; } getColumn() { return this.c; } getNumRows() { return this.nr; } getNumColumns() { return this.nc; }
  getSheet() { return this.sh; }
}
class Sheet {
  constructor(name, data) { this.name = name; this.data = data; }
  get(r, c) { return this.data[r - 1]?.[c - 1] ?? ""; }
  set(r, c, v) { while (this.data.length < r) this.data.push([]); this.data[r - 1][c - 1] = v; }
  getName() { return this.name; }
  getLastColumn() { return Math.max(0, ...this.data.map((r) => r.length)); }
  getLastRow() { return this.data.length; }
  getDataRange() { return new Range(this, 1, 1, this.data.length, this.getLastColumn()); }
  getRange(r, c, nr, nc) { return new Range(this, r, c, nr, nc); }
  clear() { this.data = []; } setFrozenRows() {}
}
const sheets = {};
wb.eachSheet((ws) => {
  const data = [];
  ws.eachRow({ includeEmpty: true }, (row, rn) => {
    const vals = []; row.eachCell({ includeEmpty: true }, (cell, cn) => { vals[cn - 1] = cell.value ?? ""; });
    data[rn - 1] = vals;
  });
  for (let i = 0; i < data.length; i++) data[i] ??= [];
  sheets[ws.name] = new Sheet(ws.name, data);
});
let active = null;
const alerts = [];
const prompts = [];
const ss = { getSheetByName: (n) => sheets[n] ?? null, insertSheet: (n) => (sheets[n] = new Sheet(n, [])) };
const menu = { addItem() { return menu; }, addSeparator() { return menu; }, addSubMenu() { return menu; }, addToUi() {} };
const Button = { OK: "OK", CANCEL: "CANCEL" };
const ui = {
  alert: (m) => { alerts.push(m); }, createMenu: () => menu, ButtonSet: { OK_CANCEL: 1 }, Button,
  prompt: () => { const t = prompts.shift(); return { getSelectedButton: () => Button.OK, getResponseText: () => t }; },
};
const props = {};
const ctx = {
  SpreadsheetApp: { getUi: () => ui, getActive: () => ss, getActiveSheet: () => active },
  PropertiesService: { getScriptProperties: () => ({
    getProperties: () => ({ ...props }), setProperties: (o) => Object.assign(props, o),
    deleteAllProperties: () => Object.keys(props).forEach((k) => delete props[k]) }) },
  UrlFetchApp: { fetch: (url, o) => {
    const args = ["-s", "-X", "POST", url, "-H", "Content-Type: application/json", "--data-binary", "@-", "-w", "\n%{http_code}"];
    for (const [k, v] of Object.entries(o.headers)) args.push("-H", `${k}: ${v}`);
    const out = execFileSync("curl", args, { input: o.payload, maxBuffer: 64 << 20 }).toString();
    const i = out.lastIndexOf("\n");
    return { getResponseCode: () => Number(out.slice(i + 1)), getContentText: () => out.slice(0, i) };
  } },
  Utilities: { formatDate: (d) => d.toISOString().slice(0, 16).replace("T", " ") },
  ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: () => ({ timeBased: () => ({ everyDays: () => ({ atHour: () => ({ inTimezone: () => ({ create() {} }) }) }) }) }) },
  console,
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL("../../apps-script/Code.gs", import.meta.url), "utf8"), ctx);

const col = (sh, h) => sh.data[0].indexOf(h);
const statuses = (name) => {
  const sh = sheets[name]; const i = col(sh, "สถานะการส่ง");
  const c = { ok: 0, err: 0, warn: 0, edit: 0, blank: 0 };
  sh.data.slice(1).forEach((r) => { const s = String(r[i] ?? ""); s.startsWith("✅") ? c.ok++ : s.startsWith("❌") ? c.err++ : s.startsWith("⚠️") ? c.warn++ : s.startsWith("✏️") ? c.edit++ : c.blank++; });
  return c;
};
let fails = 0;
const check = (name, cond, extra = "") => { console.log(`${cond ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); if (!cond) fails++; };
const last = () => alerts[alerts.length - 1] ?? "";

// 1) ตั้งค่าที่ผิด: ใส่ Secret key ผิดช่อง → ถูกปฏิเสธ
prompts.push(URL_, "sb_secret_abcdefghijklmnop", KEY); ctx.setupConnection();
check("ปฏิเสธ Secret key ในช่อง Publishable key", /Secret key ผิดช่อง/.test(last()));
// 2) ตั้งค่าถูก → ทดสอบการเชื่อมต่อ
prompts.push(URL_ + "/", ANON, " " + KEY + " "); ctx.setupConnection();
check("ตั้งค่าและทดสอบการเชื่อมต่อ", /เชื่อมต่อสำเร็จ/.test(last()), last().split("\n")[2]);

// 3) กรอกผู้ใช้ 2 คน (ถูก 1 ผิด 1) แล้วส่งทุกแท็บ
const us = sheets["ผู้ใช้งาน"]; const ei = col(us, "อีเมล (@nu.ac.th)"), ni = col(us, "ชื่อ-นามสกุล");
us.data[1][ei] = "First.Admin@nu.ac.th"; us.data[1][ni] = "ผู้ดูแล ทดสอบ";
us.data[4][ei] = "someone@gmail.com"; us.data[4][ni] = "อีเมลนอก";
const t0 = Date.now(); ctx.sendAllPending(); const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(last().replace(/\n+/g, " | "), `(${secs}s)`);
check("หน่วยงาน 43 ✅", statuses("หน่วยงาน").ok === 43, JSON.stringify(statuses("หน่วยงาน")));
check("อาคาร 204 ✅", statuses("อาคารและชั้น").ok === 204, JSON.stringify(statuses("อาคารและชั้น")));
check("ห้อง 36 ✅", statuses("ห้องและพื้นที่").ok === 36, JSON.stringify(statuses("ห้องและพื้นที่")));
check("จุดตรวจ 60 ✅", statuses("จุดตรวจ").ok === 60, JSON.stringify(statuses("จุดตรวจ")));
check("แผนการตรวจ 5 ✅", statuses("แผนการตรวจ").ok === 5, JSON.stringify(statuses("แผนการตรวจ")));
const u = statuses("ผู้ใช้งาน");
check("ผู้ใช้: 1 ✅ 1 ❌ ช่องว่างไม่ถูกส่ง", u.ok === 1 && u.err === 1, JSON.stringify(u));
check("เหตุผลภาษาไทยในแถวผิด", /โดเมนที่อนุญาต/.test(String(us.data[4][col(us, "สถานะการส่ง")])), String(us.data[4][col(us, "สถานะการส่ง")]).slice(0, 60));

// 4) ส่งซ้ำ (เฉพาะแถวใหม่/แก้ไข) → ไม่มีอะไรต้องส่งยกเว้นแถวที่ผิด
ctx.sendAllPending();
check("ส่งซ้ำ: ส่งเฉพาะแถวที่ยังไม่สำเร็จ", /อาคารและชั้น: สำเร็จ 0 · ไม่สำเร็จ 0/.test(last()) && /ผู้ใช้งาน: สำเร็จ 0 · ไม่สำเร็จ 1/.test(last()));

// 5) แก้จำนวนชั้นของอาคาร 1 แถว → onEdit ทำเครื่องหมาย → ส่งแท็บนี้
const bs = sheets["อาคารและชั้น"]; const fi = col(bs, "จำนวนชั้น");
bs.data[1][fi] = 5; ctx.onEdit({ range: bs.getRange(2, fi + 1) });
check("onEdit ทำเครื่องหมายรอส่ง", statuses("อาคารและชั้น").edit === 1);
active = bs; ctx.sendActiveSheetPending();
check("ส่งเฉพาะแถวที่แก้ (+4 ชั้น)", /สำเร็จ 1 แถว/.test(last()) && /\+4 ชั้น/.test(String(bs.data[1][col(bs, "สถานะการส่ง")])), String(bs.data[1][col(bs, "สถานะการส่ง")]));

// 6) แถวข้อมูลไม่ครบ → ⚠️ ไม่ถูกส่ง
const ls = sheets["ห้องและพื้นที่"]; ls.data.push(["PHP01", "", "ห้องใหม่", "", "ทั่วไป"]);
active = ls; ctx.sendActiveSheetPending();
check("แถวไม่ครบขึ้น ⚠️", statuses("ห้องและพื้นที่").warn === 1, last().split("\n")[2]);

// 7) ดึงรายงานทั้งหมด
ctx.exportAll();
console.log(last().replace(/\n+/g, " | "));
check("รายงาน-อาคาร 204 แถว", sheets["รายงาน-อาคาร"]?.data.length === 206);
check("รายงาน-จุดตรวจ 60 แถว", sheets["รายงาน-จุดตรวจ"]?.data.length === 62);
check("รายงาน-ผู้ใช้มีผู้ใช้ที่ลงทะเบียน", JSON.stringify(sheets["รายงาน-ผู้ใช้"]?.data ?? "").includes("first.admin@nu.ac.th"));

// 8) รหัสนำเข้าผิด
props.NU_KEY = "nuimp_" + "0".repeat(48); ctx.testConnection();
check("รหัสผิดถูกปฏิเสธ", /ไม่ถูกต้อง/.test(last()), last().split("\n")[2]);

console.log(fails ? `\n${fails} FAILED` : "\nALL APPS SCRIPT TESTS PASSED");
process.exit(fails ? 1 : 0);
