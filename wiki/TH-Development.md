# การพัฒนาและทดสอบ

[🏠 หน้าแรก](Home) · **ไทย** · [English](EN-Development)

---

## กฎพื้นฐาน

- **ห้ามเพิ่ม npm dependency** — `dependencies` ต้องว่างเปล่าตลอด ทั้ง runtime และ dev
  (`npm install` ต้องไม่จำเป็นเลย)
- ไม่มี linter ไม่มี build step ไม่มี transpiler
- CommonJS (`require`) ไม่ใช่ ES module
- โค้ดฝั่งเว็บเป็น browser script ธรรมดา ไม่มี framework ไม่มี bundler

## คำสั่งที่ใช้

```bash
node src/index.js                 # หน้าเว็บควบคุมที่ http://127.0.0.1:5011 + เปิดเบราว์เซอร์
node src/index.js --headless      # เหมือนกันแต่ไม่เปิดเบราว์เซอร์ (ใช้ตอนสั่งจาก script)
npm test                          # ชุดทดสอบด้วย node:test ไม่เพิ่ม dependency
node --check src/spoof.js         # เช็ค syntax ไฟล์เดียว
```

## ชุดทดสอบครอบคลุมอะไร

`tests/` **จงใจแคบ** — ครอบคลุมแค่ logic ที่ pure และ deterministic ที่รันได้โดยไม่แตะ state จริง
ของโปรเจกต์:

| ไฟล์ | ครอบคลุม |
|---|---|
| `tests/games.test.js` | `normalize()`, `fold()`, `GameStore` (สร้างด้วย config ที่ชี้ไป temp dir **ไม่ใช่ `config.json` จริง**) |
| `tests/spoof.test.js` | `materialize()`, `safeName()`, `signalToken()`, `candidates()`/`select()` และ guard แบบ synchronous ของ `startOne()` (รันอยู่แล้ว, `maxConcurrent`) |
| `tests/steam.test.js` | `parseAppId`, `normalizeExecutable`, `executablesInArguments`, `osKeysFor` |

## ที่จงใจไม่ทดสอบ (และเหตุผล)

| ส่วน | เหตุผล |
|---|---|
| `config.js` → `load()` / `save()` | ทั้งคู่ hardcode path ของ `config.json` จริงใต้รากโปรเจกต์ ไม่มีทางชี้ไป temp file ได้ ทดสอบก็เสี่ยงทับ config จริงของผู้ใช้ |
| อะไรที่ spawn placeholder จริง หรือเรียก `csc.exe` | ขึ้นกับ OS และสภาพเครื่อง — เป็นหน้าที่ของการตรวจด้วยมือด้านล่าง |
| `src/public/` (ฝั่งเว็บ) | เป็น browser script ที่ไม่ export อะไร และไม่มี DOM ในโปรเซสทดสอบ จะจำลองต้องเพิ่ม dependency อย่าง jsdom ซึ่งผิดกฎ zero-deps |

พฤติกรรมที่อยู่นอกขอบเขตนั้น **ตรวจกับ OS จริง ไม่ใช่ผ่าน unit test**

## การตรวจด้วยมือที่สำคัญ (Windows)

โปรเซสปลอมรันจริงหรือเปล่า:

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like "*data\runtime*" } | Select-Object ProcessId, Name, ExecutablePath
```

เป็นเจ้าของหน้าต่างไหม (ค่าที่ไม่ใช่ 0 = มี):

```powershell
(Get-Process -Id <pid>).MainWindowHandle
```

ไฟล์ประกาศตัวเองว่าเป็นอะไร:

```powershell
(Get-Item <path>).VersionInfo
```

**เก็บกวาดของค้างระหว่างรอบทดสอบ** — เซิร์ฟเวอร์ที่แครชอาจทิ้ง placeholder ไว้:

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like "*data\runtime*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

## แก้ซอร์ส C# ของ placeholder

ซอร์ส C# อยู่ในสตริงข้างใน `Spoofer.compile()` (`src/spoof.js`) **ต้องบวก `PLACEHOLDER_BUILD`
ทุกครั้งที่แก้** ไม่งั้นไฟล์ที่ cache ไว้เดิมจะถูกใช้ต่อ เพราะไฟล์ stamp เป็นตัวตัดสินว่าจะ build ใหม่ไหม
(เทียบ 3 อย่าง: ชื่อเกม, `PLACEHOLDER_BUILD`, ขนาดไฟล์)

สิ่งที่หน้าต่างแสดงต้องส่งเข้าไปเป็น **argument** เสมอ ไม่ใช่คอมไพล์ติดมา — ไม่งั้น build เดียว
จะใช้ซ้ำหลาย session ไม่ได้ และการคอมไพล์ ~800 ms จะกลับมาเกิดทุกครั้งที่กด Start

## เช็คลิสต์ก่อนแก้โค้ด

- [ ] ไม่เพิ่ม dependency
- [ ] อ่าน [invariant ทั้ง 12 ข้อ](TH-Architecture) แล้ว — แต่ละข้อได้มาจากการทำพลาดจริง
- [ ] `npm test` ผ่าน
- [ ] ถ้าแตะ `spoof.js`: ทดสอบ start/stop จริงบน Windows แล้ว และเช็คว่า `MainWindowHandle` ≠ 0
- [ ] ถ้าแตะซอร์ส C#: บวก `PLACEHOLDER_BUILD` แล้ว
- [ ] ถ้าเพิ่ม endpoint ที่คืน preset: ผ่าน `describePresets()` แล้ว
- [ ] ไม่ได้เอา executable ข้ามแพลตฟอร์มกลับมา
- [ ] เก็บกวาด placeholder ที่ค้างหลังทดสอบแล้ว
- [ ] ถ้าเปลี่ยนพฤติกรรมที่ผู้ใช้เห็น: อัปเดต **wiki ทั้งสองภาษา** (และ `README.md` + `README.en.md` ถ้าแตะส่วนเริ่มใช้หรือคำเตือน)

## แก้ wiki นี้

ไฟล์ต้นทางอยู่ที่โฟลเดอร์ `wiki/` ใน repo แล้ว sync ขึ้น GitHub Wiki
วิธี publish และกฎการเขียนลิงก์อยู่ใน [`wiki/README.md`](https://github.com/RavMonK/discord-quest-faker/blob/main/wiki/README.md)

เพิ่มหน้าใหม่ = เพิ่มทั้ง `TH-` และ `EN-` ที่ใช้ slug เดียวกัน แล้วลิงก์จาก `Home.md`
กับ `_Sidebar.md` ทั้งสองภาษา

## อ่านต่อ

- [สถาปัตยกรรมโค้ด](TH-Architecture) — invariant และเส้นทางข้อมูล
- [HTTP API](TH-HTTP-API) — สัญญาของ endpoint
- [หลักการทำงาน](TH-How-It-Works) — เหตุผลเบื้องหลังกลไก
