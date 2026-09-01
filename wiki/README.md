# wiki/

ต้นทางของ **GitHub Wiki** ของโปรเจกต์นี้ สองภาษา (ไทย / อังกฤษ)
Source of this project's **GitHub Wiki**, in Thai and English.

เก็บไว้ใน repo หลักเพื่อให้ถูก review และ version คู่กับโค้ด แล้ว sync ขึ้น wiki
Kept in the main repo so it is reviewed and versioned alongside the code, then synced to the wiki.

## โครงสร้าง / Layout

| ไฟล์ / File | คำอธิบาย / Purpose |
|---|---|
| `Home.md` | หน้าแรกของ wiki + ตัวเลือกภาษา / the wiki landing page with the language picker |
| `_Sidebar.md` | แถบนำทาง — GitHub Wiki แสดงให้ทุกหน้าอัตโนมัติ / sidebar, rendered on every wiki page |
| `_Footer.md` | ท้ายทุกหน้า — GitHub Wiki แสดงให้อัตโนมัติ / footer, rendered on every wiki page |
| `TH-*.md` | หน้าเนื้อหาภาษาไทย 13 หน้า / the 13 Thai pages |
| `EN-*.md` | หน้าเนื้อหาภาษาอังกฤษ 13 หน้า / the 13 English pages |
| `README.md` | ไฟล์นี้ — **ไม่ต้อง** อัปโหลดขึ้น wiki / this file — do **not** upload it to the wiki |

ทุกหัวข้อมีคู่ TH/EN ที่ใช้ slug เดียวกัน เช่น `TH-Getting-Started.md` ↔ `EN-Getting-Started.md`
Every topic exists as a TH/EN pair sharing one slug, e.g. `TH-Getting-Started.md` ↔ `EN-Getting-Started.md`.

## เผยแพร่ขึ้น GitHub Wiki / Publishing

Wiki เป็น git repo แยกและเก็บไฟล์แบบ **flat** (ไม่มีโฟลเดอร์ย่อย) — push *เนื้อใน* ของ `wiki/` ขึ้นไป
The wiki is a separate, **flat** git repo (no subdirectories) — push the *contents* of `wiki/`:

```bash
# ครั้งแรกต้องสร้างหน้าแรกจากหน้าเว็บ GitHub ก่อน ไม่งั้น clone ไม่ได้
# The wiki repo only exists after the first page is created from the GitHub UI
git clone https://github.com/RavMonK/discord-quest-faker.wiki.git ../dqf-wiki
cp wiki/*.md ../dqf-wiki/ && rm -f ../dqf-wiki/README.md
cd ../dqf-wiki && git add -A && git commit -m "Sync wiki from wiki/" && git push
```

ชื่อไฟล์ = ชื่อหน้า: `TH-Getting-Started.md` → `/wiki/TH-Getting-Started`
The file name is the page name: `TH-Getting-Started.md` → `/wiki/TH-Getting-Started`

## กฎการเขียนลิงก์ / Link conventions

หน้าเหล่านี้เขียนให้ถูกต้องบน **GitHub Wiki** ดังนั้น:
These pages are written to be correct on the **GitHub Wiki**, so:

- ลิงก์ระหว่างหน้า **ไม่ใส่ `.md`** — `[English](EN-Overview)` → `/wiki/EN-Overview`
  Inter-page links carry **no `.md`** — `[English](EN-Overview)` → `/wiki/EN-Overview`
- รูปและไฟล์ใน repo ใช้ **URL เต็ม** เพราะ wiki เข้าถึงไฟล์ใน repo หลักด้วย path สัมพัทธ์ไม่ได้
  Images and repo files use **absolute URLs**, since the wiki cannot reach the main repo by
  relative path:
  `https://raw.githubusercontent.com/RavMonK/discord-quest-faker/main/docs/screenshots/...`
- ผลข้างเคียง: ลิงก์ระหว่างหน้าจะกดไม่ได้ตอนอ่านไฟล์ในโฟลเดอร์นี้บน GitHub — ตั้งใจแลก
  เพราะปลายทางคือ wiki
  Trade-off: inter-page links are not clickable while browsing this folder on GitHub. That is
  intentional — the wiki is the destination.

## เพิ่มหรือแก้หน้า / Adding or editing a page

1. แก้ที่ `wiki/` ใน repo นี้เสมอ **ห้ามแก้บน wiki ตรง ๆ** ไม่งั้นการ sync ครั้งถัดไปจะทับทิ้ง
   Always edit here, **never on the wiki directly** — the next sync would overwrite it.
2. หน้าใหม่ต้องมีทั้ง `TH-` และ `EN-` ที่ใช้ slug เดียวกัน และมีหัวสลับภาษาเหมือนหน้าอื่น
   A new page needs both a `TH-` and an `EN-` file sharing one slug, with the same language
   switcher header as the others.
3. เพิ่มลิงก์ใน `Home.md` และ `_Sidebar.md` **ทั้งสองภาษา**
   Link it from `Home.md` and `_Sidebar.md` in **both languages**.
4. แก้พฤติกรรมที่ผู้ใช้เห็น = อัปเดต `README.md` (ไทย) และ `README.en.md` (อังกฤษ) ด้วยถ้าเกี่ยวกับส่วนเริ่มใช้
   User-visible behaviour changes should also land in `README.md` (Thai) and `README.en.md`
   (English) when they affect the quick start.
