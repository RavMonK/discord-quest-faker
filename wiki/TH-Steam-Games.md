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

## อ่านต่อ

- [คำสั่ง command line](TH-CLI-Reference) — `--add-steam`, `--force`, `--exe`
- [การตั้งค่า](TH-Configuration) — `custom-games.json` อยู่ไหน
- [หลักการทำงาน](TH-How-It-Works) — ทำไม executable ตัวไหนก็ใช้ได้
