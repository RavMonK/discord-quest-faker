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

`tests/` ใช้ไฟล์ชั่วคราว, HTTP server บน loopback แยกต่างหาก และ save จำลอง
จึงไม่เขียน config หรือ cache เกมจริงของโปรเจกต์:

| ไฟล์ | ครอบคลุม |
|---|---|
| `tests/games.test.js` | `normalize()`, `fold()`, `GameStore` (สร้างด้วย config ที่ชี้ไป temp dir **ไม่ใช่ `config.json` จริง**) |
| `tests/spoof.test.js` | `materialize()`, `safeName()`, `signalToken()`, `candidates()`/`select()` และ guard แบบ synchronous ของ `startOne()` (รันอยู่แล้ว, `maxConcurrent`) |
| `tests/steam.test.js` | `parseAppId`, `normalizeExecutable`, `executablesInArguments`, `osKeysFor` |
| `tests/queue.test.js` | `randomBetween`/`clampSeconds`, การจัดการลิสต์ และวงจรเลื่อนคิวทั้งวงจร โดยใช้ spoofer จำลอง (**สร้างพร้อม `save` ของตัวเอง** จึงไม่แตะ `config.json` จริง) |

## Regression tests ด้านความปลอดภัยและ Linux

- `tests/server.test.js`: ส่ง HTTP จริงบน loopback ตรวจ Host/Origin/token, request ผิดรูปแบบ, pagination และการบันทึกคิว
- `tests/security-paths.test.js`: traversal, symlink, executable ที่ถูกแก้แต่ขนาดเท่าเดิม, การเปลี่ยนไฟล์ล้มเหลว และ compiled cache
- `tests/frontend-api.test.js`: ขอ token และกู้ session เมื่อ server restart ด้วย API helper ตัวจริงของหน้าเว็บ
- `tests/linux.test.js`: รัน system/Node placeholder จริง ตรวจ `/proc/<pid>/exe`, ปฏิเสธการเริ่มซ้ำ และ auto-stop; ข้ามเมื่อไม่ใช่ Linux

ใช้ patch ล่าสุดของ Node.js 22, 24 หรือ 26 (แนะนำ 24 LTS) เปิด Docker แล้วรันจากรากโปรเจกต์:

```bash
for DQF_NODE in 22 24 26; do
  docker run --rm --network none --user node \
    --mount "type=bind,source=$(pwd),target=/app,readonly" --workdir /app \
    "node:${DQF_NODE}-bookworm-slim" node --test --test-reporter=spec || exit 1
done
```

mount ซอร์สแบบอ่านอย่างเดียว ข้อมูลทดสอบอยู่ในโฟลเดอร์ชั่วคราวของ container เท่านั้น ผลนี้ยืนยันพฤติกรรมโปรเซสบน Linux ไม่ใช่การนับ quest ของ Discord หรือ desktop GUI ต้องจำกัดสิทธิ์เขียน runtime ให้ผู้ใช้ที่เชื่อถือได้; การตรวจเหล่านี้ไม่ได้ sandbox ผู้โจมตีที่รันอยู่ในบัญชีเดียวกันแล้ว

## ที่จงใจไม่ทดสอบ (และเหตุผล)

| ส่วน | เหตุผล |
|---|---|
| `config.js` → `load()` / `save()` | ทั้งคู่ hardcode path ของ `config.json` จริงใต้รากโปรเจกต์ ไม่มีทางชี้ไป temp file ได้ ทดสอบก็เสี่ยงทับ config จริงของผู้ใช้ |
| เวลาจริงของช่องว่างในคิว | เทสต์รันด้วยช่วง `0` วินาที ส่วนที่ว่ารอ 30-70 วิจริงไหม เป็นหน้าที่ของ `randomBetween` ซึ่งทดสอบตรง ๆ อยู่แล้ว |
| GUI placeholder และ compiler บน Windows/macOS | ต้องตรวจกับ OS นั้น; process test ของ Linux รันอัตโนมัติเมื่ออยู่บน Linux |
| การ render DOM ฝั่งเว็บ | ทดสอบ API helper ด้วย `node:vm`; ส่วน render ยังต้องใช้เบราว์เซอร์ |

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

ซอร์ส C# อยู่ใน `Spoofer.compileWindows()` (`src/spoof.js`) บวก `PLACEHOLDER_BUILD`
เมื่อแก้ซอร์สที่สร้างขึ้น ใช้ไฟล์ compiled ซ้ำได้เมื่อชื่อเกม, build version และ SHA-256
ตรงกับข้อมูลในหน่วยความจำของโปรเซสนี้เท่านั้น เปิดโปรแกรมใหม่จะคอมไพล์ใหม่หนึ่งครั้ง
ไม่เชื่อถือ stamp ที่เก็บบนดิสก์

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
