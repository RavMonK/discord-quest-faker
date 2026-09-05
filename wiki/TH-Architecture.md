# สถาปัตยกรรมโค้ด

[🏠 หน้าแรก](Home) · **ไทย** · [English](EN-Architecture)

---

หกโมดูลใต้ `src/` ประกอบกันใน `index.js` ไม่มี dependency ภายนอกเลย ไม่มี build step

```
index.js ── parse arg, โหมด CLI, จัดการพอร์ต, สัญญาณปิดโปรแกรม
   ├── config.js   อ่าน/เขียน config.json
   ├── games.js    GameStore: ดึงลิสต์, cache, ค้นหา, รวมเกมที่เพิ่มเอง
   │      └── steam.js   แปลง Steam appinfo ให้เป็นรูปแบบเดียวกับ entry ของ Discord
   ├── spoof.js    Spoofer: สร้างไฟล์ปลอม, รัน, ดูแล session
   ├── queue.js    QuestQueue: เล่นทีละเกมต่อกันไป เว้นระยะแบบสุ่ม
   └── server.js   HTTP API + เสิร์ฟไฟล์ static จาก public/
          └── public/   หน้าเว็บควบคุม (HTML/CSS/JS ล้วน)
```

## หน้าที่ของแต่ละโมดูล

### `config.js`

โหลด/บันทึก `config.json` — สองกฎที่ encode ไว้ในนี้:

- **ทน BOM** (editor บน Windows เขียนมาให้)
- **ไฟล์ที่ parse ไม่ผ่าน ไม่เขียนทับเด็ดขาด** (`save()` คืน `null` แทน)

CLI override อย่าง `--port` / `--headless` มีผลกับ config ในหน่วยความจำเท่านั้น — `fileState`
เก็บสิ่งที่ควรอยู่บนดิสก์ไว้ต่างหาก เพื่อไม่ให้ flag รั่วลงไฟล์ และเขียนกลับแค่ `EDITABLE_KEYS`

### `games.js`

`GameStore` เก็บสามลิสต์:

| ลิสต์ | ที่มา |
|---|---|
| `detectable` | จาก Discord (cache ไว้ที่ `data/games.json`) |
| `custom` | เพิ่มเอง (`data/custom-games.json`) |
| `games` | ผลรวมของสองอันบน — ทุกส่วนอ่านจากอันนี้ |

การ refresh จะแทนที่แค่ `detectable` แล้ว merge ใหม่ **เกมที่เพิ่มเองจึงไม่หาย**

- `normalize()` ย่อ payload 12 MB เหลือแค่ field ที่ใช้ และ**ทิ้ง executable ที่มี `..`**
  (ลิสต์นี้นักพัฒนาส่งเข้ามาเอง จึงเชื่อไม่ได้ 100%)
- `fold()` ตัด accent ตอนค้นหา — ถ้าไม่มีอันนี้ `marvel tokon` จะหา `MARVEL Tōkon` ไม่เจอ
- เขียนไฟล์แบบ atomic (`.tmp` แล้ว rename) และ **ถ้า refresh ล้มเหลวจะเก็บลิสต์เดิมไว้**

### `steam.js`

แปลง Steam app id/URL ให้เป็น game shape เดียวกัน ผ่าน `api.steamcmd.net`
(steamdb.info เองตอบ 403 กับ automated request แต่ข้อมูล appinfo เป็นชุดเดียวกัน)
รายละเอียดที่ [เพิ่มเกมจาก Steam](TH-Steam-Games)

### `spoof.js`

หัวใจของโปรแกรม ~1,740 บรรทัด ส่วนใหญ่เป็นซอร์ส C#, Objective-C และ C ของ placeholder —
อธิบายที่ [หลักการทำงาน](TH-How-It-Works) เมธอดสำคัญ:

| เมธอด | ทำอะไร |
|---|---|
| `tiers()` | ลำดับ fallback: `compiled` → `system` → `node` (macOS ไม่มีชั้น `system`) |
| `candidates(game)` | executable ของระบบนี้ ตัดตัวซ้ำ launcher ไว้ท้าย |
| `select(game, wanted)` | แปลง `"all"` / ชื่อ / index → รายการ executable |
| `materialize(game, exe)` | สร้าง path ไฟล์ปลอม (รวม directory prefix และ `.app` bundle) |
| `provision(target, tier, ...)` | สร้าง placeholder ตามชั้นนั้น คืน args + นโยบายรีสตาร์ท |
| `compile(target, name)` | คอมไพล์ placeholder และ cache SHA-256 ในหน่วยความจำเฉพาะรอบที่เปิดโปรแกรมนี้ |
| `ensureIcon(game)` | คืน path ไอคอนทันที โหลดจริงแบบ background |
| `startOne(game, exe, opts)` | ยิงทีละชั้นจนติด ผูก handler `exit`/`error` ตั้ง timer auto-stop |
| `stop(key, sync)` | `taskkill /T /F` บน Windows, SIGTERM→SIGKILL บน Unix |

### `queue.js`

`QuestQueue` เล่นรายการเกม **ทีละตัว** — สตาร์ตรายการหนึ่งด้วยเวลา auto-stop ของรายการนั้น
พอ session จบก็รอแบบสุ่มเป็นวินาที แล้วค่อยสตาร์ตรายการถัดไป

| เมธอด | ทำอะไร |
|---|---|
| `add` / `update` / `remove` / `move` / `clear` | จัดการตัวลิสต์ และบันทึกลง `config.json` |
| `start()` | ตั้งทุกรายการกลับเป็น `pending` แล้วเริ่มตัวแรก คิวที่จบแล้วจึงเล่นซ้ำได้ |
| `stop(sync)` | หยุดคิวและเกมที่รันอยู่ — `sync` คือแบบที่ใช้ตอนปิดโปรแกรม |
| `skip()` | หยุดตัวที่เล่นอยู่ (แล้วรอตามปกติ) หรือถ้ากำลังรออยู่ ก็เริ่มตัวถัดไปทันที |
| `randomDelaySeconds()` | สุ่มใหม่ทุกช่องว่าง จากช่วง `queueDelayMinSeconds`–`queueDelayMaxSeconds` |
| `onSessionEnd(info)` | callback จาก spoofer ที่ทำให้คิวขยับ |
| `describe()` | ทุกอย่างที่หน้าเว็บวาด รวม `nextStartAt` สำหรับนับถอยหลัง |

สามข้อที่โมดูลนี้พึ่งพาอยู่:

- **`Spoofer.onSessionEnd`** เป็นทางเดียวที่จะรู้ว่า session จบไปเองแล้ว คิวจะตอบสนองเฉพาะ
  session key ที่ตัวเองสตาร์ตเท่านั้น เกมที่ผู้ใช้กดเองจึงไม่ทำให้คิวขยับ
- **สุ่มใหม่ทุกช่องว่าง ด้วย `crypto.randomInt`** — ถ้าใช้ค่าคงที่ หรือสุ่มครั้งเดียวแล้วใช้ทั้งรอบ
  นั่นคือ pattern ที่ช่วงสุ่มนี้มีไว้เลี่ยงพอดี
- **`stop()` เคลียร์ `running` ก่อนฆ่า placeholder** เพราะการฆ่าจะไปเรียก callback ตัวเดียวกัน
  ถ้าลำดับสลับ คิวจะเข้าใจว่า "เกมเล่นจบแล้ว" แล้วสตาร์ตตัวถัดไปทั้งที่ผู้ใช้สั่งหยุด

ตอนปิดโปรแกรมจะหยุดคิวก่อน และใช้การฆ่าแบบ **synchronous** เพราะ `taskkill` แบบ async
ไม่ได้รันแล้วเมื่อ `process.exit` กำลังทำงาน ไฟล์ปลอมจะค้างอยู่

### `server.js`

HTTP server ด้วย `http` เปล่า ๆ เสิร์ฟไฟล์จาก `src/public/` และ JSON API ใต้ `/api/`
รายละเอียด endpoint ที่ [HTTP API](TH-HTTP-API)

## เส้นทางข้อมูล: จากกด Start ถึง Discord เห็น

```
หน้าเว็บ  POST /api/start { id, executable, durationMinutes }
   └── store.resolve(id)                → หา game entry
   └── spoofer.start(game, opts)
          └── Spoofer.select()          → executable ที่จะรัน
          └── startOne()
                 ├── กันซ้ำ + เช็ค maxConcurrent
                 ├── materialize()      → data/runtime/<id>/<exe>
                 ├── provision('compiled')
                 │      ├── compile()   → csc.exe / clang / cc (cache ไว้)
                 │      └── ensureIcon()→ โหลด background
                 ├── spawn(fakePath, args, { windowsHide: false })
                 │      → หน้าต่างเด้งขึ้น  ← สิ่งที่ Discord มองหา
                 └── ตั้ง timer auto-stop (ถ้ามี)
   └── ตอบกลับ { ok, sessions, running }
```

Discord scan โปรเซส เห็น path ที่ลงท้ายตรงกับ entry ของมัน แล้วขึ้นสถานะ "กำลังเล่น"

## invariant ที่ห้ามแตะ (แต่ละข้อได้มาจากการทำพลาด)

1. **placeholder ต้องเป็นเจ้าของหน้าต่างที่มองเห็นได้** — โปรเซสเงียบ ๆ ไม่มีหน้าต่างไม่ถูกตรวจจับ
   ต้อง spawn ด้วย `windowsHide: false`
2. **path ต้องตรงทั้งหาง ไม่ใช่แค่ basename** — `_retail_/wow-64.exe` ต้องสร้างโฟลเดอร์นำหน้าด้วย
3. **ตัวตนของไฟล์เองมีความหมาย** — `waitfor.exe` ที่เปลี่ยนชื่อยังบอกว่าตัวเองคือ waitfor
   ของ Microsoft ตัวที่คอมไพล์เองจึงฝังชื่อเกมและคอมไพล์ตรงไปที่ path สุดท้าย
4. **session key คือ `<game id>::<executable>`** — เกมเดียวจึงรันหลาย executable พร้อมกันได้
5. **`waitfor` ปฏิเสธชื่อ signal ที่ถูกใช้อยู่** — ทุก session ต้องมี `signalToken()` ของตัวเอง
   ถ้าใช้ token เดียวกัน executable ตัวที่สองขึ้นไปจะถูกฆ่าเงียบ ๆ
6. **id เกมและชื่อ executable มาจากภายนอก** — ตรวจรูปแบบ ID, ปฏิเสธ traversal,
   ตรวจว่า path อยู่ใน runtime และไม่มี symlink ก่อนสร้างไฟล์
7. **`copyBinary()` ตรวจ SHA-256 เทียบต้นฉบับ** — ใช้สำเนาแยกทุก OS แทน hard link
   เปลี่ยนไฟล์ที่ถูกแก้ไขแบบ atomic และหยุดเมื่อสร้างไฟล์ที่เชื่อถือได้ไม่สำเร็จ
8. **นโยบายรีสตาร์ทต่างกันตามชั้นโดยเจตนา** — `system`/`node` หมดเวลาแล้วรันใหม่, `compiled`
   จบเพราะผู้ใช้ปิดหน้าต่าง = สั่งหยุด **ห้ามรันใหม่**
9. **ปิดโปรแกรมต้องใช้ kill แบบ sync** — `stopAll(true)` เพราะ async kill ไม่รอด `process.exit`
10. **ทุก endpoint ที่คืน preset ต้องผ่าน `describePresets()`** — `config.json` เก็บแค่
    id/name/executable ส่งดิบ ๆ ให้ UI แล้ว `renderPresets` จะ throw กลางการ render
    ทำให้หน้าเว็บว่างเปล่าจนถึงรอบ poll ถัดไป
11. **`PLACEHOLDER_BUILD` ต้องบวกเมื่อแก้ซอร์ส C#** — cache ในหน่วยความจำตรวจชื่อเกม, build version และ SHA-256
    เปิดโปรแกรมใหม่จะ build ใหม่หนึ่งครั้ง ไม่เชื่อถือ stamp บนดิสก์
12. **ห้ามเอา executable ข้ามแพลตฟอร์มกลับมา** — โปรเซสชื่อ `.exe` บน macOS เป็น signal
    ที่ตรวจจับง่ายเกินไป (ดู [ความต่างของแต่ละระบบ](TH-Platform-Notes))

## ข้อเท็จจริงเชิงโดเมนที่ควรจำ

- Discord แม็ปโปรเซสเข้ากับ application id **หนึ่งอัน** — รันหลาย executable ของเกมเดียว
  ไม่ได้ progress เพิ่ม UI จึงรันตัวเดียว และ preset เก็บ executable ตัวเดียว (ไม่เก็บ `"all"`)
  ไม่มีปุ่ม "start all" ที่ไหนเลย
- ลิสต์ detectable เอียงไปทาง Windows อย่างหนัก: **10,447 / 62 / 8** (win32 / darwin / linux)
- **executable ตัวไหนก็ใช้ได้** — `cod.exe` และ `cod26-cod.exe` ต่างก็ได้ MW4
- `executable` ของ Steam มักเป็นแค่ bootstrapper ตัวเกมจริงอยู่ใน `arguments`
- ชื่อของ Steam กับ Discord ไม่ตรงกัน และ **id ของ Discord เท่านั้นที่นับ quest** —
  `findDetectableTwin()` จัดการเรื่องนี้
- `data/` และ `config.json` gitignore ไว้ — เป็น state ของผู้ใช้ ไม่ใช่ source
- พอร์ตไม่ว่างไม่ใช่ทางตัน — `offerToFreePort()` บอกชื่อโปรเซสและเสนอ kill ให้ แต่**ถามเฉพาะ
  ตอนมี TTY** (สั่งจาก script ต้องไม่ kill อะไรที่ไม่มีใครอนุมัติ)

## อ่านต่อ

- [HTTP API](TH-HTTP-API) — endpoint ทั้งหมด
- [การพัฒนาและทดสอบ](TH-Development) — ทดสอบอะไรได้/ไม่ได้ และเพราะอะไร
- [หลักการทำงาน](TH-How-It-Works) — กลไกการปลอมโดยละเอียด
