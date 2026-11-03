// สร้างคู่มือฉบับเว็บ (public/manual/index.html) จาก docs/manual/manual.html
// เปิดได้โดยไม่ต้องเข้าสู่ระบบที่ https://<โดเมนระบบ>/manual — ภาพทั้งหมดเป็นข้อมูลสมมติ
// ใช้: node tests/manual/build-web.mjs (หลัง build-pdf.mjs เพื่อคัดลอก PDF ไปด้วย)
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = path.join(ROOT, "docs/manual/manual.html");
const OUT = path.join(ROOT, "public/manual");
const PDF = "คู่มือการใช้งาน-NU-Safety-Inspection.pdf";
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "img"), { recursive: true });

// ภาพ: JPEG ขนาดพอดีจอ
execFileSync("python3", ["-c", `
import sys, glob, os
from PIL import Image
for f in glob.glob(sys.argv[1] + "/*.png"):
    im = Image.open(f).convert("RGB")
    if im.width > 1200: im = im.resize((1200, round(im.height * 1200 / im.width)), Image.LANCZOS)
    im.save(os.path.join(sys.argv[2], os.path.basename(f)[:-4] + ".jpg"), quality=72, optimize=True, progressive=True)
`, path.join(ROOT, "docs/manual/img"), path.join(OUT, "img")]);
fs.copyFileSync(path.join(ROOT, "public/nu-logo.png"), path.join(OUT, "img/nu-logo.png"));
if (fs.existsSync(path.join(ROOT, "docs/manual", PDF))) fs.copyFileSync(path.join(ROOT, "docs/manual", PDF), path.join(OUT, "manual.pdf"));

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("file://" + SRC);
await page.evaluate(() => {
  // สารบัญเป็นลิงก์ภายในหน้า
  const toc = document.getElementById("toc");
  toc.innerHTML = [...document.querySelectorAll(".content .part, .content h2")].map((el) => {
    const isPart = el.classList.contains("part");
    const label = isPart ? `${el.querySelector(".k").textContent} ${el.dataset.toc}` : el.textContent.trim();
    return `<a class="l${isPart ? 1 : 2}" href="#${el.id}"><span>${label}</span></a>`;
  }).join("");
  document.querySelectorAll('img[src^="img/"]').forEach((im) => im.setAttribute("src", im.getAttribute("src").replace(/\.png$/, ".jpg")));
  document.querySelectorAll('img[src$="nu-logo.png"]').forEach((im) => im.setAttribute("src", "img/nu-logo.png"));
  // ฟอนต์: ใช้ Google Fonts แทนไฟล์ในเครื่อง
  const st = document.querySelector("style");
  st.textContent = st.textContent.replace(/@font-face[^}]*}\s*/g, "").replace('"SarabunDoc"', '"Sarabun"');
  const link = document.createElement("link");
  link.rel = "stylesheet"; link.href = "https://fonts.googleapis.com/css2?family=Sarabun:ital,wght@0,400;0,600;0,700;1,400&display=swap";
  document.head.prepend(link);
  // หน้าเปิดที่ /manual (ไม่มี / ท้าย) → อ้างอิงไฟล์ภาพจาก /manual/
  const base = document.createElement("base");
  base.href = "/manual/";
  document.head.prepend(base);
  const meta = document.createElement("meta");
  meta.name = "viewport"; meta.content = "width=device-width, initial-scale=1";
  document.head.prepend(meta);
  const css = document.createElement("style");
  css.textContent = `
    @media screen {
      html { background:#eef0f3; scroll-behavior:smooth; }
      body { max-width: 920px; margin: 0 auto; background:#fff; padding: 0 28px 40px; box-shadow: 0 0 24px rgba(0,0,0,.08); }
      .cover { display:none; }
      .webbar { position: sticky; top: 0; z-index: 5; display:flex; align-items:center; gap:12px; justify-content:space-between; background:#fff;
        border-bottom:1px solid #e5e7eb; margin: 0 -28px 18px; padding: 10px 28px; }
      .webbar img { width: 40px; height: 40px; }
      .webbar b { display:block; color:#1d2c4b; font-size: 16px; }
      .webbar span { font-size: 13px; color:#6b7280; }
      .webbar a { white-space:nowrap; background:#F26F21; color:#fff; border-radius:8px; padding:8px 12px; text-decoration:none; font-weight:600; font-size:14px; }
      .hero { background: linear-gradient(110deg,#1d2c4b,#27406b); color:#fff; border-radius: 14px; padding: 22px 24px; margin-bottom: 18px; }
      .hero h1 { margin:0; font-size: 28px; } .hero p { margin:6px 0 0; color:#dfe6f3; }
      .front { break-after:auto !important; }
      .toc a { text-decoration:none; } .toc a:hover span { color:#F26F21; text-decoration: underline; }
      .part { margin-top: 36px; scroll-margin-top: 70px; } h2 { scroll-margin-top: 70px; }
      img.mob { max-width: 100%; }
    }
    @media screen and (max-width: 700px) {
      body { padding: 0 14px 30px; } .webbar { margin: 0 -14px 14px; padding: 8px 14px; }
      .side, .pair, .two, .flow { display:block; } .side figure, .pair figure { margin: 0 auto 10px; }
      .flow .ar { display:none; } .flow .st { margin-bottom: 6px; }
      table { display:block; overflow-x:auto; } img.desk, img.desk.s { width:100% !important; }
      .hero h1 { font-size: 22px; } .front p { text-align:left; text-indent:0; }
    }`;
  document.head.appendChild(css);
  const bar = document.createElement("div");
  bar.className = "webbar";
  bar.innerHTML = `<div style="display:flex;align-items:center;gap:10px"><img src="img/nu-logo.png" alt=""><div><b>คู่มือการใช้งาน NU Safety Inspection</b><span>ระบบตรวจสอบความปลอดภัยอาคาร มหาวิทยาลัยนเรศวร · ฉบับที่ 2.0</span></div></div>
    <a href="manual.pdf" download>ดาวน์โหลด PDF</a>`;
  const hero = document.createElement("div");
  hero.className = "hero";
  hero.innerHTML = `<h1>คู่มือการใช้งานระบบการตรวจความปลอดภัย</h1><p>มหาวิทยาลัยนเรศวร · NU Safety Inspection · สำหรับผู้ใช้งานทุกบทบาท — ภาพและข้อมูลในคู่มือเป็นข้อมูลสมมติ</p>`;
  document.body.prepend(hero);
  document.body.prepend(bar);
  document.title = "คู่มือการใช้งาน NU Safety Inspection";
});
fs.writeFileSync(path.join(OUT, "index.html"), "<!doctype html>\n" + (await page.content()).replace(/^<!DOCTYPE html>/i, ""));
await browser.close();
const size = execFileSync("du", ["-sh", OUT]).toString().split("\t")[0];
console.log(`สร้าง public/manual/ (${size}) — เปิดที่ /manual`);
