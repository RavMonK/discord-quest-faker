# Discord Quest Faker

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

โปรแกรมเล็ก ๆ ที่ **ดึงรายชื่อเกมที่ Discord ตรวจจับได้** จาก
`https://discord.com/api/v10/applications/detectable` มาเก็บเป็นไฟล์ JSON
แล้วสร้าง "โปรเซสเกมปลอม" ให้ Discord มองเห็นว่าเรากำลังเล่นเกมนั้นอยู่
เพื่อให้ quest ประเภท *"เล่นเกม X เป็นเวลา Y นาที"* เดินหน้าไปได้

ทำงานได้ทั้ง **Windows และ macOS** (รวมถึง Linux) — ใช้ Node.js ล้วน ๆ ไม่มี dependency ภายนอกสักตัว

---

## ⚠️ คำเตือนก่อนใช้งาน / Disclaimer

**ภาษาไทย**

- โปรแกรมนี้ทำให้ Discord **แสดงสถานะที่ไม่ตรงกับความจริง** ว่าคุณกำลังเล่นเกมที่จริง ๆ ไม่ได้เล่น
  ซึ่ง**ขัดกับเงื่อนไขการใช้งาน (Terms of Service) ของ Discord**
- การใช้งานอาจทำให้ **quest ถูกยกเลิก รางวัลถูกเรียกคืน หรือบัญชีถูกจำกัด/ระงับ** ได้
  ความเสี่ยงทั้งหมดเป็นของผู้ใช้เอง ผู้เขียนไม่รับผิดชอบต่อความเสียหายใด ๆ
- เผยแพร่เพื่อ**การศึกษาและใช้ส่วนตัว**เท่านั้น ห้ามนำไปใช้หากินหรือใช้ในทางที่ผิด
- โปรเจกต์นี้**ไม่มีส่วนเกี่ยวข้อง**กับ Discord, Steam/Valve, SteamDB หรือผู้พัฒนาเกมใด ๆ
  ชื่อเกมและเครื่องหมายการค้าทั้งหมดเป็นของเจ้าของนั้น ๆ
- ถ้าไม่รับความเสี่ยงข้างต้น **อย่าใช้**

**English**

This tool makes Discord report that you are playing a game you are not actually playing, which
**violates Discord's Terms of Service**. Using it may get quests voided, rewards revoked, or your
account limited or banned. It is published for **educational and personal use only** and comes
with no warranty of any kind — see [LICENSE](LICENSE). You use it entirely at your own risk, and
the author accepts no liability for any consequence.

This project is **not affiliated with, endorsed by, or connected to** Discord, Valve/Steam,
SteamDB, or any game publisher. All game names and trademarks belong to their respective owners.
No Discord credentials, tokens, or account data are used, read, or transmitted by this tool — it
only starts local placeholder processes on your own machine.

---

## หลักการทำงาน

Discord ตรวจจับเกมด้วยการไล่ดู **path ของโปรเซสที่กำลังรันอยู่** แล้วเทียบกับรายการ `executables`
ในลิสต์ detectable ของมันเอง เช่น Overwatch คือ `overwatch.exe`, League of Legends คือ
`garenalolth/gamedata/apps/lolth/lolex.exe`

โปรแกรมนี้จึงแค่สร้างไฟล์ที่มี **ชื่อและโครงสร้างโฟลเดอร์ตรงตามนั้น** แล้วรันทิ้งไว้:

| ลำดับ | แพลตฟอร์ม | วิธีสร้างไฟล์ | ขนาด | RAM |
|---|---|---|---|---|
| 1 | Windows | คอมไพล์ exe จริงด้วย `csc.exe` **+ เปิดหน้าต่างจริง** | 5 KB | ~20 MB |
| 2 | Windows | ก๊อป `System32\waitfor.exe` (ไม่มีหน้าต่าง) | 64 KB | ~6 MB |
| 2 | macOS / Linux | ก๊อป `/bin/sleep` (ไม่มีหน้าต่าง) | ~150 KB | ~2 MB |
| 3 | ทุกแพลตฟอร์ม | ก๊อป `node.exe` ตัวที่กำลังรัน (ไม่มีหน้าต่าง) | ~90 MB | ~35 MB |

ไล่จากบนลงล่าง ถ้าชั้นไหนใช้ไม่ได้จะเลื่อนไปชั้นถัดไปให้เองอัตโนมัติ

### สำคัญที่สุด: ต้องมีหน้าต่างจริง

**Discord ไม่ได้ดูแค่ชื่อโปรเซส — มันมองหาโปรเซสที่เป็นเจ้าของหน้าต่างที่มองเห็นได้ด้วย**
โปรเซสที่รันเงียบ ๆ ไม่มีหน้าต่าง จะไม่ถูกตรวจจับถึงแม้ชื่อไฟล์จะตรงเป๊ะก็ตาม

placeholder ที่คอมไพล์เองจึงเปิด **หน้าต่างจริงพร้อม message loop** โดยตั้ง title เป็นชื่อเกม
(แนวทางเดียวกับ [discord-quest-completer](https://github.com/markterence/discord-quest-completer)
ที่ใช้ `CreateWindowExW` + `ShowWindow(hWnd, SW_SHOWNORMAL)` + message loop ใน WinAPI)

> **ปิดหน้าต่าง = หยุดเกมนั้น** เหมือนกดปุ่ม Stop ในหน้าเว็บ โปรแกรมจะไม่เปิดขึ้นมาใหม่ให้

**ทำไมไม่ก๊อปไฟล์ระบบมาเฉย ๆ:** นอกจากเรื่องหน้าต่างแล้ว ไฟล์ที่ก๊อปมายังฝังตัวตนเดิมไว้ข้างใน —
`waitfor.exe` ที่เปลี่ยนชื่อเป็น `wwm.exe` ยังบอก Windows ว่าตัวเองคือ
*"waitfor - wait/send a signal over a network" ของ Microsoft Corporation*
(Task Manager จึงโชว์ชื่อนั้น ทำให้ค้นหา `wwm` ในแท็บ Processes ไม่เจอทั้งที่โปรเซสรันอยู่จริง)

ส่วน exe ที่คอมไพล์เองมี `FileDescription`, `ProductName`, `OriginalFilename` ตรงกับเกมและชื่อไฟล์จริง
คอมไพล์ครั้งแรก ~0.8 วินาทีต่อ executable แล้ว cache ไว้ใช้ซ้ำ

⚠️ ชั้นที่ 2 และ 3 **ไม่มีหน้าต่าง** จึงมีโอกาสสูงที่ Discord จะตรวจไม่เจอ —
ถ้าโปรแกรมถอยไปใช้ชั้นเหล่านั้นจะขึ้น warning ในหน้าเทอร์มินัลให้เห็น ทางแก้คือติดตั้ง
.NET Framework เพื่อให้มี `csc.exe` (Windows ส่วนใหญ่มีมาให้อยู่แล้ว)
ส่วนบน macOS/Linux ใช้ `/bin/sleep` ซึ่งไม่มีหน้าต่างเช่นกัน — ยังไม่ได้ทดสอบว่า Discord
บนสองระบบนี้ต้องการหน้าต่างหรือไม่

บน macOS ระบบจะสร้าง app bundle ให้ครบด้วย เช่น
`world of warcraft.app/Contents/MacOS/world of warcraft` เหมือนเกมจริง

---

## ความต้องการ

- **Node.js 18 ขึ้นไป** — ดาวน์โหลดจาก <https://nodejs.org> (macOS ใช้ `brew install node` ก็ได้)
- **Discord เวอร์ชัน desktop** เปิดค้างไว้ (เวอร์ชันเว็บตรวจจับเกมไม่ได้)
- เปิดสิทธิ์แชร์กิจกรรมใน Discord: **User Settings → Activity Privacy →
  "Share your detected activities with others"** ต้องเปิดอยู่

---

## วิธีใช้

### Windows

ดับเบิลคลิก `start.bat` หรือรันในเทอร์มินัล:

```bash
node src/index.js
```

### macOS / Linux

```bash
chmod +x start.sh && ./start.sh
```

โปรแกรมจะ:

1. โหลดรายชื่อเกมจากไฟล์ cache ขึ้นมาก่อน (เปิดใช้ได้ทันที)
2. **ดึงลิสต์ใหม่จาก Discord แบบ background** แล้วเขียนทับ `data/games.json` (~10,400 เกม)
3. เปิดหน้าเว็บควบคุมที่ <http://127.0.0.1:5011> ให้อัตโนมัติ

ในหน้าเว็บ: พิมพ์ค้นหาเกม → กด **Start** → Discord จะขึ้นว่ากำลังเล่นเกมนั้น
(ลิสต์โหลดเพิ่มเองเมื่อเลื่อนลง ไม่ต้องพิมพ์ค้นให้แคบลงก็ไล่ดูครบทั้งหมื่นเกมได้)
กด **★** เพื่อบันทึกเกมลง `config.json` เป็น preset แล้วครั้งต่อไปกดปุ่มเดียวรันได้เลย
(จะลบ preset ทิ้ง กดปุ่ม **Remove** ในกล่อง Presets)

กด Start แล้วจะมี **หน้าต่างเล็ก ๆ ชื่อเกมนั้นเด้งขึ้นมา** — นั่นคือโปรเซสปลอมที่ Discord ต้องเห็น
ปล่อยเปิดไว้ อย่าปิด (ปิดหน้าต่าง = หยุดเกมนั้น เท่ากับกด Stop)

ในหน้าต่างนั้นจะเห็น **รูปเกม**, ชื่อไฟล์ที่กำลังปลอมเป็น, **เวลาที่เดินมาแล้ว** (นับทุกวินาที)
และบรรทัด **Auto-stop** ที่บอกว่าเหลืออีกกี่นาทีจะหยุดเอง — ถ้าไม่ได้ตั้งไว้จะขึ้นว่า `off`
(รูปโหลดจาก CDN ของ Discord/Steam ครั้งเดียวแล้วเก็บไว้ใน `data/runtime/_icons/`
ถ้าเกมนั้นไม่มีรูปหรือโหลดไม่ได้ จะขึ้นเป็นตัวอักษรแรกของชื่อเกมแทน)

เกมจะค้างอยู่จนกว่าจะกด Stop หรือปิดหน้าต่าง ยกเว้นตั้ง **Auto-stop** ไว้ว่าให้หยุดกี่นาที

### เกมที่มีหลาย executable

หลายเกมมี executable มากกว่าหนึ่งตัวในลิสต์ Discord เช่น League of Legends มี 4 ตัว
และ World of Warcraft มี 6 ตัว

**ปุ่ม Start จะรันแค่ตัวเดียว** เพราะ Discord แม็ปโปรเซสเข้ากับ application id ของเกม —
เจอ executable ตัวไหนตัวหนึ่งก็ขึ้นว่า "กำลังเล่นเกมนี้" เหมือนกัน การรันพร้อมกันหลายตัว
ไม่ได้ทำให้ quest เดินเร็วขึ้น มีแต่จะเปลืองโปรเซสเปล่า ๆ

ถ้าอยากเลือกตัวอื่น กดปุ่ม **▸** หน้าชื่อเกม (หรือกดที่ชื่อเกมก็ได้) เพื่อกางรายการ
แล้ว Start/Stop ทีละตัวได้
(ตัวที่เป็น launcher จะติดป้าย `LAUNCHER` และถูกจัดไว้ท้ายสุดเสมอ)
ถ้าเผลอเปิดหลายตัว ปุ่มจะกลายเป็น **Stop all (N)** ให้ปิดทีเดียวได้

### บน macOS / Linux

ลิสต์ของ Discord แยก executable ตามระบบปฏิบัติการ และ**ฝั่ง macOS มีน้อยมาก**:

| ระบบ | จำนวนเกมที่มี executable |
|---|---|
| Windows | 10,447 |
| macOS | **62** |
| Linux | 8 |

โปรแกรมจะแสดงเฉพาะเกมที่มี executable ของระบบที่กำลังรันอยู่ บน Mac จึงเห็นแค่ 62 เกมนั้น
ส่วนเกมที่มีแต่ฝั่ง Windows (เช่น MARVEL Tōkon) จะไม่ขึ้นมาเลย

**ทำไมไม่เปิดให้ข้ามแพลตฟอร์ม:** ในทางเทคนิคทำได้ — บน Unix นามสกุลไฟล์ไม่มีความหมาย
จะสร้างและรันไฟล์ชื่อ `redsteam.exe` บน Mac ก็ได้ แต่**จงใจไม่ทำ** เพราะโปรเซสชื่อ `.exe`
ที่รันอยู่บน macOS เป็นสิ่งที่เกิดขึ้นเองไม่ได้กับเกมจริง เท่ากับป้ายบอกชัด ๆ ว่ากำลังปลอม
ซึ่งเป็น signal ที่ตรวจจับง่ายเกินไป — ความเสี่ยงไม่คุ้มกับที่ได้

อีกข้อที่ต่างกัน: placeholder ฝั่ง macOS/Linux ใช้ `/bin/sleep` ซึ่ง**ไม่มีหน้าต่าง** ต่างจากฝั่ง
Windows ที่คอมไพล์ตัวมีหน้าต่างได้ ถ้า Discord บน Mac ต้องการหน้าต่างแบบเดียวกับฝั่ง Windows
วิธีนี้ก็จะไม่ทำงาน — ยังไม่ได้ทดสอบบนเครื่องจริง

### เกมที่ไม่มีในลิสต์ของ Discord

ช่อง **"Game missing from Discord's list?"** ใต้รายการเกม รับ SteamDB URL, Steam store URL
หรือ app id เปล่า ๆ แล้วดึงรายชื่อ executable จาก launch config ของ Steam มาสร้างเป็นเกมของเราเอง:

```
https://steamdb.info/app/3787240/config/     → MARVEL Tōkon: Fighting Souls (6 executables)
https://store.steampowered.com/app/570/      → Dota 2
4783780                                       → app id เปล่า ๆ ก็ได้
```

เกมที่เพิ่มเองจะติดป้าย `STEAM` เก็บไว้ที่ `data/custom-games.json` (ไม่หายตอน refresh ลิสต์)
และลบได้ด้วยปุ่ม **✕**

**ถ้าเกมนั้นมีใน Discord อยู่แล้ว** โปรแกรมจะไม่สร้าง entry ซ้ำ แต่จะพาไปที่ entry ของ Discord ให้
พร้อมข้อความอธิบายใต้ช่อง (ไม่ใช่ error — เป็นผลลัพธ์ที่ถูกต้อง เพราะ entry ของ Discord เท่านั้นที่นับ quest)
ถ้ายืนยันว่าอยากเก็บ entry จาก Steam จริง ๆ กดปุ่ม **Add anyway** ข้างข้อความนั้น

> **หมายเหตุสำคัญ:** SteamDB บล็อกการดึงข้อมูลอัตโนมัติ (Cloudflare 403) โปรแกรมจึงดึงจาก
> `api.steamcmd.net` ซึ่งเป็นข้อมูล appinfo ชุดเดียวกับที่หน้า config ของ SteamDB แสดง

**ข้อจำกัดที่ต้องเข้าใจ:** quest ของ Discord ผูกกับ application id ในลิสต์ detectable ของ Discord เอง
เกมที่เพิ่มจาก Steam จะ**ไม่นับ quest** เพราะ Discord ไม่รู้จัก id นั้น — ใช้ได้แค่ให้ Discord
แสดงสถานะกำลังเล่น โดยต้องไปเพิ่มเองที่ **Settings → Registered Games → Add it!** ตอนที่โปรเซสรันอยู่

### ชื่อ executable ของ Steam กับของ Discord ไม่จำเป็นต้องตรงกัน

เคสจริง: `https://steamdb.info/app/4783780/config/` (CoD MW4 Beta)

| แหล่ง | executable |
|---|---|
| Steam — ช่อง `executable` | `bootstrapper.exe` |
| Steam — ช่อง `arguments` | `cod26-cod.exe` |
| ลิสต์ detectable ของ Discord | `cod.exe`, `sp26-cod.exe`, `cod26-cod.exe` |

`bootstrapper.exe` เป็นแค่ตัวปล่อยเกม ตัวเกมจริงอยู่ในช่อง **Arguments** ของหน้า config ใน SteamDB
โปรแกรมจึงอ่านทั้งสองช่อง และจัดพวก bootstrapper/launcher ไว้ท้ายสุดเสมอ:

```
   [0] cod26-cod.exe
   [1] bootstrapper.exe  (launcher)
```

ส่วนฝั่ง Discord — **ตัวไหนในลิสต์ก็ใช้ได้** ทดสอบแล้วทั้ง `cod.exe` และ `cod26-cod.exe`
ต่างก็ถูก detect เพราะ Discord แม็ปโปรเซสเข้ากับ application id เดียวกัน
ที่รันไม่ได้คือ `bootstrapper.exe` ซึ่งไม่มีอยู่ในลิสต์ของ Discord เลย

โปรแกรมจึงเช็คให้ก่อนทุกครั้งที่เพิ่มเกม ถ้า Discord มีเกมนั้นอยู่แล้ว **จะไม่สร้าง custom entry
ที่รันไปก็ไม่มีประโยชน์** แต่จะพาไปที่ entry ของ Discord พร้อมกางรายการ executable ให้เลือก:

```
[steam] "Call of Duty®: Modern Warfare® 4 - Beta" is already in Discord's list
        as "Call of Duty: Modern Warfare 4"
        Steam lists:   bootstrapper.exe
        Discord wants: cod.exe, sp26-cod.exe, cod26-cod.exe
   [0] cod.exe
   [1] sp26-cod.exe
   [2] cod26-cod.exe
```

แล้วเลือกตัวที่ต้องการเอง:

```bash
node src/index.js --start "Call of Duty: Modern Warfare 4" --exe "cod26-cod.exe"
```

ในหน้าเว็บก็กดลูกศร **▸** แล้วกด Start ที่ `cod26-cod.exe` ได้เลย

ถ้าอยากบันทึก entry จาก Steam จริง ๆ ทั้งที่ Discord มีอยู่แล้ว ใส่ `--force`

### ใช้ผ่าน command line

```bash
node src/index.js --list fortnite            # ค้นหาเกม + ดู index ของแต่ละ executable
node src/index.js --add-steam 3787240        # เพิ่มเกมที่ไม่มีในลิสต์ Discord จาก Steam
node src/index.js --add-steam 4783780 --force  # บันทึก entry ของ Steam ทั้งที่ Discord มีอยู่แล้ว
node src/index.js --start "Rocket League"    # รัน executable ตัวแรก (Ctrl+C เพื่อหยุด)
node src/index.js --start "League of Legends" --exe all      # รันทุก executable (ปกติไม่จำเป็น)
node src/index.js --start "World of Warcraft" --exe 2        # เลือกด้วย index จาก --list
node src/index.js --start "World of Warcraft" --exe "_retail_/wow.exe"   # เลือกด้วยชื่อ
node src/index.js --start "Overwatch" --duration 60          # หยุดเองใน 60 นาที
node src/index.js --refresh                  # อัปเดต data/games.json อย่างเดียวแล้วออก
node src/index.js --headless --port 8080     # ไม่เปิดเบราว์เซอร์ / เปลี่ยนพอร์ต
node src/index.js --presets                  # รันทุก preset ใน config.json ทันทีที่เปิด
node src/index.js --help
```

`--list` จะแสดง executable ทั้งหมดพร้อมเลข index ที่ใช้กับ `--exe` ได้:

```
  League of Legends                             1402418696126992445
      [0] garenalolth/gamedata/apps/lolth/lolex.exe
      [1] league of legends.exe
      [2] garenaloltw/gamedata/apps/loltw/lol.exe
      [3] leagueclientux.exe  (launcher)
```

---

## config.json

ไฟล์นี้ถูกสร้างให้อัตโนมัติในครั้งแรกที่รัน

```json
{
  "port": 5011,
  "host": "127.0.0.1",
  "openBrowser": true,
  "apiUrl": "https://discord.com/api/v10/applications/detectable",
  "gamesFile": "data/games.json",
  "customGamesFile": "data/custom-games.json",
  "refreshOnStart": true,
  "refreshIntervalMinutes": 720,
  "runtimeDir": "data/runtime",
  "defaultDurationMinutes": 0,
  "maxConcurrent": 12,
  "presets": [
    { "id": "356875221078245376", "name": "Overwatch", "executable": "overwatch.exe", "durationMinutes": 60 }
  ],
  "autoStartPresets": false
}
```

| key | ความหมาย |
|---|---|
| `port` / `host` | ที่อยู่ของหน้าเว็บควบคุม |
| `openBrowser` | เปิดเบราว์เซอร์ให้อัตโนมัติตอนเริ่มโปรแกรม |
| `refreshOnStart` | ดึงลิสต์เกมใหม่ทุกครั้งที่เปิดโปรแกรม (แบบ background) |
| `refreshIntervalMinutes` | ดึงลิสต์ซ้ำทุก ๆ กี่นาที (`0` = ไม่ดึงซ้ำ) |
| `defaultDurationMinutes` | เวลาหยุดอัตโนมัติเริ่มต้น (`0` = รันจนกว่าจะกดหยุด) |
| `maxConcurrent` | จำนวนโปรเซสปลอมที่รันพร้อมกันได้สูงสุด (นับแยกต่อ executable) |
| `presets` | รายการเกมที่กดปุ่มเดียวรันได้ — เพิ่มจากปุ่ม ★ ในหน้าเว็บ หรือแก้ไฟล์เอง |
| `autoStartPresets` | รันทุก preset ทันทีที่เปิดโปรแกรม |

`presets[].id` ใช้ application id ก็ได้ ชื่อเกมก็ได้ (เช่น `"name": "Overwatch"`)

`presets[].executable` เลือกได้ว่าจะรัน executable ตัวไหน: ชื่อไฟล์ (`"lolex.exe"`), เลข index,
array ของชื่อ หรือ `"all"` ถ้าอยากรันทุกตัวจริง ๆ — ปุ่ม ★ จะบันทึกเป็นชื่อ executable ตัวที่ใช้อยู่ให้เอง

---

## ไฟล์ที่โปรแกรมสร้าง

```
data/games.json          รายชื่อเกมจาก Discord (~3 MB, 10,400 เกม) — ลบได้ เดี๋ยวดึงใหม่
data/custom-games.json   เกมที่เพิ่มเองจาก Steam — ไม่ถูกเขียนทับตอน refresh
data/runtime/            ไฟล์ exe ปลอมของแต่ละเกม — ลบได้ตอนไม่ได้รันอยู่
config.json              ตั้งค่าและ preset ของคุณ
```

โปรเซสปลอมทั้งหมดจะถูกปิดให้อัตโนมัติเมื่อปิดโปรแกรม (Ctrl+C หรือปิดหน้าต่าง)

---

## ข้อจำกัดที่ควรรู้

- ใช้ได้กับ quest แบบ **"เล่นเกม"** เท่านั้น — quest ที่ต้อง **stream ให้เพื่อนดู** หรือ **ดูวิดีโอ**
  ทำแบบนี้ไม่ได้ เพราะ Discord ตรวจจากอย่างอื่น
- Discord desktop ต้องเปิดอยู่ตลอดเวลาที่รันเกมปลอม
- ถ้าเกมที่ quest กำหนดไม่มีในลิสต์ detectable ก็หลอกไม่ได้
- โปรแกรมนี้ทำให้ Discord แสดงสถานะที่ไม่ตรงความจริง ซึ่งขัดกับเงื่อนไขการใช้งานของ Discord —
  ใช้ด้วยความเข้าใจความเสี่ยงต่อบัญชีของคุณเอง

---

## แก้ปัญหา

| อาการ | วิธีแก้ |
|---|---|
| `node : command not found` | ยังไม่ได้ติดตั้ง Node.js หรือยังไม่ได้เปิดเทอร์มินัลใหม่หลังติดตั้ง |
| `port 5011 is already in use` | โปรแกรมจะบอกว่าโปรเซสไหนถือพอร์ตอยู่ (ชื่อ + pid) แล้วถามว่าจะ kill ทิ้งไหม — ตอบ `y` เพื่อยึดพอร์ตนั้น หรือตอบ `n` แล้วเปลี่ยน `port` ใน `config.json` / รันด้วย `--port 8080` |
| หาโปรเซสใน Task Manager ไม่เจอ | ค้นในแท็บ **Details** ด้วยชื่อไฟล์ (แท็บ Processes ค้นจาก *ชื่อที่ไฟล์ประกาศตัวเอง* ไม่ใช่ชื่อไฟล์) |
| `config.json is not valid JSON` | ไฟล์พิมพ์ผิด — โปรแกรมจะไม่เขียนทับให้ แก้ไฟล์แล้วเปิดใหม่ |
| เกมที่ต้องการหาไม่เจอ | กด **Refresh list** หรือรัน `node src/index.js --refresh` |

### Discord ไม่ขึ้นว่ากำลังเล่นเกม

ไล่เช็คตามนี้:

1. **ยืนยันก่อนว่าโปรเซสรันจริง** — เปิด Task Manager แท็บ **Details** (ไม่ใช่ Processes)
   แล้วหาชื่อไฟล์ เช่น `wwm.exe` หรือรันคำสั่งนี้:

   ```bash
   tasklist /FI "IMAGENAME eq wwm.exe"
   ```

2. **เปิดการตรวจจับเกมใน Discord** — Settings → **Registered Games** →
   เปิด *"Display currently running game as a status message"*
3. **เปิดการแชร์กิจกรรม** — Settings → **Activity Privacy** →
   เปิด *"Share your detected activities with others"*
4. **ใช้ Discord ตัว desktop** (เวอร์ชันเว็บตรวจจับโปรเซสไม่ได้เลย)
5. ถ้ายังไม่ขึ้น ลอง **รีสตาร์ท Discord** ทั้งที่โปรเซสปลอมยังรันอยู่
6. **ทดสอบว่า Discord มองเห็นโปรเซสไหม** — ที่ Settings → Registered Games กด **"Add it!"**
   แล้วดูว่ามีชื่อเกมอยู่ในรายการโปรเซสที่ Discord เห็นหรือเปล่า
   ถ้ามี = Discord มองเห็นโปรเซสแล้ว ปัญหาอยู่ที่ฝั่งการจับคู่/ตั้งค่า
   ถ้าไม่มี = Discord ไม่ scan โปรเซสนั้นเลย

---

## โครงสร้างโค้ด

```
src/index.js        จุดเริ่มโปรแกรม + โหมด command line
src/config.js       อ่าน/เขียน config.json (กัน BOM, ไม่เขียนทับไฟล์ที่พัง)
src/games.js        ดึงลิสต์จาก Discord, ย่อข้อมูล, cache, ค้นหา, รวมเกมที่เพิ่มเอง
src/steam.js        ดึง launch config จาก Steam appinfo (สำหรับเกมนอกลิสต์)
src/spoof.js        สร้างและรันโปรเซสเกมปลอม
src/server.js       HTTP API ของหน้าเว็บควบคุม
src/public/         หน้าเว็บควบคุม (HTML/CSS/JS ล้วน)
```

---

## License

[MIT](LICENSE) © 2026 RavMonK

แนวคิดการทำ placeholder ที่มีหน้าต่างจริง อ้างอิงจาก
[markterence/discord-quest-completer](https://github.com/markterence/discord-quest-completer)
