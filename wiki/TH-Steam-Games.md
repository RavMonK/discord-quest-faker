# เพิ่มเกมจาก Steam

[🏠 หน้าแรก](Home) · **ไทย** · [English](EN-Steam-Games)

---

เกมที่ไม่มีในลิสต์ detectable ของ Discord ยังเพิ่มเข้ามาเองได้ โดยอ่านรายชื่อ executable
จาก **launch config ของ Steam**

## วิธีเพิ่ม

### จากหน้าเว็บ

ช่อง **"Game missing from Discord's list? Add it from Steam:"** ใต้รายการเกม รับ:

```
https://steamdb.info/app/3787240/config/     → MARVEL Tōkon: Fighting Souls (6 executables)
https://store.steampowered.com/app/570/      → Dota 2
4783780                                       → app id เปล่า ๆ ก็ได้
```

รับ `steamcommunity.com/app/<id>`, ลิงก์ `steam://` และ URL ที่มี `?appid=` ด้วย

### จาก command line

```bash
node src/index.js --add-steam 3787240
node src/index.js --add-steam https://steamdb.info/app/3787240/config/
```

เกมที่เพิ่มเองจะติดป้าย `steam` เก็บไว้ที่ `data/custom-games.json` (**ไม่หายตอน refresh ลิสต์**)
และลบได้ด้วยปุ่ม **✕**

> **หมายเหตุ:** SteamDB บล็อกการดึงข้อมูลอัตโนมัติ (Cloudflare 403) โปรแกรมจึงดึงจาก
> `api.steamcmd.net` ซึ่งเป็นข้อมูล appinfo ชุดเดียวกับที่หน้า config ของ SteamDB แสดง

## ⚠️ ข้อจำกัดที่ต้องเข้าใจก่อน

**quest ของ Discord ผูกกับ application id ในลิสต์ detectable ของ Discord เอง**
เกมที่เพิ่มจาก Steam จะ **ไม่นับ quest** เพราะ Discord ไม่รู้จัก id นั้น

ใช้ได้แค่ให้ Discord **แสดงสถานะว่ากำลังเล่น** โดยต้องไปเพิ่มเองที่
**Settings → Registered Games → Add it!** ตอนที่โปรเซสกำลังรันอยู่

## ถ้าเกมนั้นมีใน Discord อยู่แล้ว

โปรแกรมจะ **ไม่สร้าง entry ซ้ำ** แต่จะพาไปที่ entry ของ Discord ให้ พร้อมข้อความอธิบาย
(ไม่ใช่ error — เป็นผลลัพธ์ที่ถูกต้อง เพราะ entry ของ Discord เท่านั้นที่นับ quest)

ในหน้าเว็บ: ข้อความจะขึ้นใต้ช่อง พร้อมปุ่ม **Add anyway** ถ้ายืนยันว่าอยากเก็บ entry ของ Steam จริง ๆ
จาก command line: ใส่ `--force`

การจับคู่ (`findDetectableTwin()`) ให้คะแนน 3 ระดับ:

| คะแนน | เงื่อนไข |
|---|---|
| 3 | ชื่อเกมตรงกันหลังตัดคำต่อท้ายอย่าง `beta`, `demo`, `playtest`, `early access` ออก |
| 2 | มีชื่อ executable ตรงกันอย่างน้อยหนึ่งตัว |
| 1 | ชื่อหนึ่งเป็นส่วนหนึ่งของอีกชื่อ (ต้องยาว ≥ 8 ตัวอักษร) |

ถ้าคะแนนเท่ากัน ชื่อที่ยาวกว่าจะชนะ (`"... modern warfare 4"` ชนะการจับคู่แบบหลวม ๆ ที่สั้นกว่า)

## ชื่อ executable ของ Steam กับของ Discord ไม่จำเป็นต้องตรงกัน

เคสจริง: `https://steamdb.info/app/4783780/config/` (CoD MW4 Beta)

| แหล่ง | executable |
|---|---|
| Steam — ช่อง `executable` | `bootstrapper.exe` |
| Steam — ช่อง `arguments` | `cod26-cod.exe` |
| ลิสต์ detectable ของ Discord | `cod.exe`, `sp26-cod.exe`, `cod26-cod.exe` |

`bootstrapper.exe` เป็นแค่ตัวปล่อยเกม ตัวเกมจริงอยู่ในช่อง **Arguments** ของหน้า config
โปรแกรมจึงอ่าน **ทั้งสองช่อง** และจัดพวก bootstrapper/launcher ไว้ท้ายสุดเสมอ:

```
   [0] cod26-cod.exe
   [1] bootstrapper.exe  (launcher)
```

ส่วนฝั่ง Discord — **ตัวไหนในลิสต์ก็ใช้ได้** ทดสอบแล้วทั้ง `cod.exe` และ `cod26-cod.exe`
ต่างก็ถูก detect เพราะแม็ปเข้ากับ application id เดียวกัน ที่รันไม่ได้คือ `bootstrapper.exe`
ซึ่งไม่มีอยู่ในลิสต์ของ Discord เลย

โปรแกรมจึงเช็คให้ก่อนทุกครั้ง แล้วรายงานแบบนี้:

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

ในหน้าเว็บก็กด **▸** แล้วกด Start ที่ `cod26-cod.exe` ได้เลย

## โปรแกรมอ่านอะไรจาก Steam

`src/steam.js` แปลง Steam appinfo ให้เป็นรูปแบบเดียวกับ entry ของ Discord จนโค้ดส่วนอื่น
แยกไม่ออกว่ามาจากไหน:

```json
{
  "id": "steam:3787240",
  "appId": "3787240",
  "name": "MARVEL Tōkon: Fighting Souls",
  "iconUrl": "https://cdn.cloudflare.steamstatic.com/...",
  "custom": true,
  "source": "steam",
  "executables": [{ "name": "...", "os": "win32", "isLauncher": false }]
}
```

รายละเอียดที่ควรรู้:

- **ระบบปฏิบัติการ** มาจาก `oslist` ของ launch entry ถ้า Steam เว้นว่าง (บ่อย) จะเดาจาก
  นามสกุลไฟล์: `.exe` → win32, `.app` → darwin, `.sh` / `.x86_64` → linux
- **ช่อง arguments** ถูกอ่านหา token ที่ลงท้าย `.exe`/`.app`/`.sh`/`.bat`/`.x86_64` โดย
  **ตัด switch ออก** — ข้อมูลของ Counter-Strike 2 มี `-steam.exe` อยู่จริง ๆ
- **path ถูกทำให้ปลอดภัย** — backslash เป็น slash, ตัด `./` และ `/` นำหน้า, ทิ้ง entry ที่มี `..`
- ชื่อที่ขึ้นต้นด้วย `start_protected_game`, `bootstrapper` หรือ `launcher` ถูกทำเครื่องหมายเป็น
  launcher และจัดไว้ท้าย
- ถ้า app นั้นไม่มี launch executable เลย จะได้ error ไม่ใช่ entry เปล่า
- **URI ของ launcher ไม่ใช่ executable** บางเกมส่งต่อให้ launcher ตัวอื่นเปิด ช่อง `executable`
  ของ Steam จึงเป็น URI ไม่ใช่ไฟล์ — EA SPORTS FC 27 มี `steam2ea://launchgame/4080220?...`
  อะไรที่อยู่ในรูป `scheme://...` จะถูกทิ้ง และถ้า launch config ไม่มีอย่างอื่นเลย จะได้ error ที่
  บอกชื่อ launcher นั้น Steam ไม่รู้ชื่อ process จริงของเกมพวกนี้ ต้องรอให้ entry ของ Discord
  ใส่ executable ก่อน แล้วค่อย `--refresh` — หรือพิมพ์ path ของ process เอง (ด้านล่าง)

## เพิ่มเกมจาก path ของ process

ถ้า Steam ไม่มีอะไรให้ใช้ — อย่าง EA SPORTS FC 27 ด้านบน — ให้พิมพ์ path ที่ process ของเกมรันอยู่แทน
บนหน้าเว็บคือแถว **"…or type the game's process path yourself:"** ใต้ช่อง Steam ส่วน CLI:

```bash
node src/index.js --add-exe "EA SPORTS FC 27\FC27.exe"
node src/index.js --add-exe "FC27.exe" --name "EA SPORTS FC 27"
```

- **รู้ชื่อโฟลเดอร์ก็ใส่ไปด้วย** Discord จับคู่ที่*ส่วนท้าย*ของ path และ entry ของซีรีส์นี้มีโฟลเดอร์ด้วย
  (`ea sports fc 26/fc26.exe`) ถ้าใส่แค่ `FC27.exe` ก็น่าจะไม่ตรงเมื่อ Discord ใส่เกมนี้ในลิสต์
  โฟลเดอร์จะถูกสร้างใหม่ใต้ `data/runtime/custom-<ชื่อ>/` เหมือน entry ของ Discord ทุกประการ
- **ใส่ path เต็มได้** — `C:\Games\EA SPORTS FC 27\FC27.exe` ที่ copy มาจาก Task Manager จะถูกตัด
  drive letter ออก เหลือส่วนที่เหลือ ซึ่งยังลงท้ายถูก
- **ใช้ game id ของ Discord ถ้ามี** ในหน้าโปรไฟล์เกมบน Discord กด **⋯ → Copy Game ID** แล้วใส่นำหน้า
  path — `1531874756096295054\EA SPORTS FC 27\FC27.exe` — หรือใส่ในช่องชื่อ / `--id` entry จะใช้ application id
  ของ Discord และดึงชื่อกับไอคอนมาจาก Discord (`/applications/<id>/rpc` ไม่ต้อง login) Discord อาจรู้จักเกม
  — หรือมี quest ของเกมนั้นแล้ว — ก่อนที่ entry ใน detectable list จะมี executable สักตัว อย่าง EA Sports FC 27
  และตราบใดที่ entry ยังไม่มี executable **เครื่องมือนี้ทำอะไรให้ detect ไม่ได้เลย** (ลองใส่ `SteamAppId` ของ Steam
  ใน environment ของ placeholder แล้ว Discord ไม่สนใจ) พอ entry ของ Discord มี executable แล้ว การเพิ่มใหม่จะถูก
  พาไปที่ entry นั้น ส่วน entry ที่บันทึกไว้แล้วด้วย id เดียวกันจะแค่เพิ่ม path ของตัวเองเข้าไปใน entry ของ Discord
  ไม่ได้บังของ Discord — จึงทิ้งไว้ได้ไม่เสียหาย
- **ชื่อเกม** ค่าเริ่มต้นคือชื่อโฟลเดอร์ที่ไฟล์อยู่ (`EA SPORTS FC 27`) หรือชื่อไฟล์ที่ตัด `.exe` ออก
  เพิ่ม path อื่นด้วยชื่อเดิมจะเป็น executable ตัวที่สองของเกมเดิม ไม่ใช่เกมใหม่
- **ที่ใช้ไม่ได้:** `..`, ตัวอักษรที่ Windows ห้าม (`< > : " | ? *`), บน Windows ชื่อที่ไม่ลงท้าย
  `.exe` และบน macOS/Linux ชื่อที่ลงท้าย `.exe` — เกมจริงบนระบบพวกนั้นไม่มีทางเป็น process `foo.exe`
- **Discord มีอยู่แล้ว?** ถ้า path ตรงกับ — หรือเป็นส่วนท้ายของ — executable ในลิสต์ของ Discord
  (`FC26.exe` → *EA Sports FC 26*) จะพาไปที่ entry นั้นเหมือนตอนเพิ่มจาก Steam
  กด **Add anyway** / ใส่ `--force` ถ้าต้องการบันทึกของเราเองจริง ๆ

เกมแบบนี้ติดป้าย `custom` และเก็บใน `data/custom-games.json` ร่วมกับเกมจาก Steam ข้อจำกัดด้านบนยังใช้
เหมือนเดิม: entry ของเราเองไม่ได้อะไร มันจะมีผลก็ต่อเมื่อ path ที่พิมพ์ตรงกับที่อยู่ในลิสต์ของ **Discord**
— Discord จับคู่ process กับลิสต์ของตัวเอง ไม่ใช่กับ id ของเครื่องมือนี้ — เช่นเกมที่ Discord เพิ่งใส่
หลังจากดึง `data/games.json` มา

## อ่านต่อ

- [คำสั่ง command line](TH-CLI-Reference) — `--add-steam`, `--add-exe`, `--force`, `--exe`
- [การตั้งค่า](TH-Configuration) — `custom-games.json` อยู่ไหน
- [หลักการทำงาน](TH-How-It-Works) — ทำไม executable ตัวไหนก็ใช้ได้
