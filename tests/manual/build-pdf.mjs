// แปลงคู่มือ docs/manual/manual.html เป็น PDF พร้อมสารบัญและเลขหน้า
// ใช้: node tests/manual/build-pdf.mjs  (ต้องมี pdftotext และ python3 + pypdf)
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = path.join(ROOT, "docs/manual/manual.html");
const OUT = path.join(ROOT, "docs/manual/คู่มือการใช้งาน-NU-Safety-Inspection.pdf");
const TMP = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "manual-"));

const footer = `<div style="width:100%;font-family:SarabunAll,sans-serif;font-size:8.5pt;color:#4b5563;padding:0 17mm;display:flex;justify-content:space-between;align-items:center;-webkit-print-color-adjust:exact">
  <span style="display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#F26F21"></span><span>คู่มือการใช้งานระบบการตรวจความปลอดภัย (NU Safety Inspection) · ฉบับที่ 1.0</span></span>
  <span class="pageNumber" style="font-weight:600;color:#1d2c4b"></span></div>`;

// ภาพหน้าจอแปลงเป็น JPEG ก่อนฝังใน PDF (ลดขนาดไฟล์ PDF หลายเท่า)
const IMG = path.join(ROOT, "docs/manual/img");
execFileSync("python3", ["-c", `
import sys, glob, os
from PIL import Image
for f in glob.glob(sys.argv[1] + "/*.png"):
    im = Image.open(f).convert("RGB")
    if im.width < 900:   # ภาพมือถือ (ถ่ายที่ 2x) แสดงกว้าง ~54 มม. — 600 px ก็คมพอ
        im = im.resize((600, round(im.height * 600 / im.width)), Image.LANCZOS)
    im.save(os.path.join(sys.argv[2], os.path.basename(f)[:-4] + ".jpg"), quality=82, optimize=True, progressive=True)
`, IMG, TMP]);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("file://" + SRC);
await page.evaluate((tmp) => {
  document.querySelectorAll('img[src^="img/"]').forEach((im) => { im.src = "file://" + tmp + "/" + im.getAttribute("src").slice(4).replace(/\.png$/, ".jpg"); });
}, TMP);
await page.waitForLoadState("load");
await page.evaluate(() => Promise.all([...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))));
await page.evaluate(() => document.fonts.ready);

// ภาพที่ตามด้วยคำอธิบายหมายเลข ให้อยู่หน้าเดียวกัน
await page.evaluate(() => document.querySelectorAll(".content figure + ol.co").forEach((co) => {
  const fig = co.previousElementSibling;
  const wrap = document.createElement("div");
  wrap.className = "keep";
  fig.before(wrap);
  wrap.append(fig, co);
}));

// ให้หัวข้ออยู่หน้าเดียวกับภาพ/ตารางแรกของหัวข้อ (ไม่ค้างหัวข้อไว้ท้ายหน้า)
await page.evaluate(() => {
  document.querySelectorAll(".content h2, .content h3, .content h4").forEach((h) => {
    const group = [h];
    let n = h.nextElementSibling;
    while (n && !n.matches("h2, h3, .part")) {
      group.push(n);
      if (n.matches("table")) { group.pop(); break; }   // ตารางยาวแบ่งหน้าได้ ไม่รวมในกลุ่ม
      if (n.matches("figure, .side, .pair, ol.co, .flow, .two, .keep")) break;
      n = n.nextElementSibling;
    }
    const wrap = document.createElement("div");
    wrap.className = "keep";
    h.before(wrap);
    group.forEach((e) => wrap.appendChild(e));
  });
});

// ตารางสั้น (ไม่เกิน 10 แถว) ไม่แบ่งข้ามหน้า
await page.evaluate(() => document.querySelectorAll(".content table").forEach((t) => {
  if (t.querySelectorAll("tbody tr").length <= 10) t.style.breakInside = "avoid";
}));

// สร้างรายการสารบัญจากหัวข้อ + ใส่เครื่องหมายที่มองไม่เห็นไว้หาเลขหน้า
const entries = await page.evaluate(() => {
  const list = [];
  document.querySelectorAll(".content .part, .content h2").forEach((el, i) => {
    const key = `ZZTOC${String(i).padStart(3, "0")}ZZ`;
    const m = document.createElement("span");
    m.textContent = key;
    Object.assign(m.style, { position: "absolute", left: "0", top: "0", fontSize: "1px", lineHeight: "1px", color: el.classList.contains("part") ? "#1d2c4b" : "#ffffff" });
    el.style.position = "relative";
    el.appendChild(m);
    const isPart = el.classList.contains("part");
    const label = isPart ? `${el.querySelector(".k").textContent} ${el.dataset.toc}` : el.textContent.replace(key, "").trim();
    list.push({ key, label, level: isPart ? 1 : 2 });
  });
  return list;
});
await page.evaluate((entries) => {
  const toc = document.getElementById("toc");
  toc.innerHTML = entries.map((e) => `<a class="l${e.level}"><span>${e.label}</span><span class="dots"></span><span class="pg" data-key="${e.key}">00</span></a>`).join("");
}, entries);

const hide = (sel) => page.addStyleTag({ content: `${sel}{display:none!important}` });
const pdf = (file, withFooter) => page.pdf({ path: file, preferCSSPageSize: true, printBackground: true, displayHeaderFooter: withFooter, headerTemplate: "<span></span>", footerTemplate: footer });

// 1) เนื้อหา (เลขหน้าเริ่มที่ 1)
const front = await hide(".front-only");
await pdf(path.join(TMP, "content.pdf"), true);
await front.evaluate((el) => el.remove());

// 2) หาเลขหน้าจากข้อความใน PDF
const pages = execFileSync("pdfinfo", [path.join(TMP, "content.pdf")]).toString().match(/Pages:\s+(\d+)/)[1] * 1;
const found = {};
for (let pg = 1; pg <= pages; pg++) {
  const txt = execFileSync("pdftotext", ["-f", String(pg), "-l", String(pg), path.join(TMP, "content.pdf"), "-"]).toString();
  for (const k of txt.match(/ZZTOC\d{3}ZZ/g) ?? []) found[k] ??= pg;
}
const missing = entries.filter((e) => !found[e.key]);
if (missing.length) throw new Error("ไม่พบเลขหน้า: " + missing.map((e) => e.label).join(", "));
await page.evaluate((found) => document.querySelectorAll(".toc .pg").forEach((el) => (el.textContent = found[el.dataset.key])), found);

// 3) ปก คำนำ สารบัญ (ไม่มีเลขหน้า)
await hide(".content");
await pdf(path.join(TMP, "front.pdf"), false);
await browser.close();

execFileSync("python3", ["-c", `
import sys
from pypdf import PdfWriter, PdfReader
w = PdfWriter()
for f in sys.argv[1:3]:
    for p in PdfReader(f).pages: w.add_page(p)
w.add_metadata({"/Title": "คู่มือการใช้งาน ระบบการตรวจความปลอดภัย มหาวิทยาลัยนเรศวร (NU Safety Inspection)", "/Author": "มหาวิทยาลัยนเรศวร"})
w.write(sys.argv[3])
`, path.join(TMP, "front.pdf"), path.join(TMP, "content.pdf"), OUT]);
console.log(`สร้าง ${path.relative(ROOT, OUT)} — เนื้อหา ${pages} หน้า, สารบัญ ${entries.length} รายการ`);
fs.rmSync(TMP, { recursive: true, force: true });
