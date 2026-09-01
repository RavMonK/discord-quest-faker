# หน้าเว็บควบคุม

[🏠 หน้าแรก](Home) · **ไทย** · [English](EN-Control-Panel)

---

หน้าเว็บอยู่ที่ <http://127.0.0.1:5011> (เปลี่ยนได้ที่ [config.json](TH-Configuration))
เป็น HTML/CSS/JS ล้วน ไม่มี framework ไม่มี build step

<p align="center">
  <img src="https://raw.githubusercontent.com/RavMonK/discord-quest-faker/main/docs/screenshots/control-panel.png" alt="หน้าควบคุม Discord Quest Faker" width="820">
</p>

## แถบด้านบน

| ส่วน | ความหมาย |
|---|---|
| ป้ายระบบ (`win32` / `darwin` / `linux`) | ระบบที่โปรแกรมกำลังรันอยู่ — ตัวกำหนดว่าเห็นเกมอะไรบ้าง |
| ข้อความสถานะลิสต์ | `<จำนวนเกมทั้งหมด> games · <จำนวนที่รันได้บนระบบนี้> for <os> · updated <เมื่อไหร่>` |
| **Refresh list** | ดึงลิสต์เกมใหม่จาก Discord ทันที (เท่ากับ `--refresh` แต่ไม่ปิดโปรแกรม) |

**แถบเตือนสีเหลือง** ด้านบนเป็นคำเตือนเรื่อง Terms of Service กด *เข้าใจแล้ว / Got it* แล้วจะจำไว้
ใน `localStorage` ของเบราว์เซอร์ ไม่ขึ้นอีก

## กล่อง Running

ทุกโปรเซสปลอมที่รันอยู่ตอนนี้ แต่ละแถวโชว์:

- ไอคอนและชื่อเกม
- ชื่อ executable ที่ปลอมเป็น · `pid <เลข>` · `auto-stop <N> min` (ถ้าตั้งไว้)
- **นาฬิกาเดินสด** นับเวลาที่รันมาแล้ว
- ปุ่ม **Stop** — หยุดแค่ executable ตัวนั้น
- ปุ่ม **Stop all** บนหัวกล่อง — หยุดทุกตัวทีเดียว

หน้าเว็บดึงสถานะจากเซิร์ฟเวอร์ทุก **5 วินาที** เพราะฉะนั้นสิ่งที่เกิดจากที่อื่น (auto-stop ทำงาน,
ผู้ใช้ปิดหน้าต่างโปรเซสปลอม, สั่งจาก command line) จะโผล่มาที่นี่เองไม่ต้องรีเฟรช

## กล่อง Presets

เกมที่บันทึกไว้ใน `config.json` — กดปุ่มเดียวรันได้

| ปุ่ม | ทำอะไร |
|---|---|
| **Start** | รัน executable ที่บันทึกไว้ ด้วย auto-stop ที่บันทึกไว้ (ถ้ามี) |
| **Stop** / **Stop all (N)** | หยุด executable ทุกตัวของเกมนั้น |
| **Remove** | ลบ preset ออกจาก `config.json` (ไม่ได้หยุดเกมที่รันอยู่) |
| **▸** | กางรายการ executable ทั้งหมด เพื่อรันตัวอื่นแทนตัวที่บันทึกไว้ |
| **Not detectable** (กดไม่ได้) | preset ชี้ไปที่ id ที่ไม่มีในลิสต์ปัจจุบันแล้ว |

บรรทัดล่างของแต่ละ preset บอกว่า `config.json · <ชื่อ executable ที่จะรัน>` และ auto-stop ที่ตั้งไว้

> preset **เก็บ executable ได้ตัวเดียว** ไม่เก็บ `"all"` — ถ้าไฟล์เก่ามี `"all"` อยู่ โปรแกรมจะ
> เขียนทับให้เป็น executable ตัวแรกตอนเปิดโปรแกรม พร้อมพิมพ์บอกในเทอร์มินัล

## กล่อง Games

### ช่องค้นหา

- ค้นจาก **ชื่อเกม, application id, alias และชื่อ executable**
- ตัดวรรณยุกต์/accent ให้ — พิมพ์ `marvel tokon` เจอ `MARVEL Tōkon`, `pokemon` เจอ `Pokémon`
- หน่วง 180 ms ก่อนยิงค้น และผลลัพธ์ที่ตรงเป๊ะ/ขึ้นต้นตรงจะถูกดันขึ้นก่อน
- โหลดหน้าละ 100 รายการ **เพิ่มเองเมื่อเลื่อนลง** — ไม่พิมพ์ค้นก็ไล่ดูครบทั้งหมื่นเกมได้
- บรรทัดใต้ลิสต์บอกว่า `Showing X of Y — scroll for more`

### ช่อง Auto-stop after ... min

จำนวนนาทีที่จะใช้กับทุก **Start** ที่กดจากกล่องนี้ — `0` = รันจนกว่าจะสั่งหยุด
ค่าเริ่มต้นมาจาก `defaultDurationMinutes` ใน `config.json`

### แต่ละแถวเกม

| ส่วน | ความหมาย |
|---|---|
| **☆ / ★** | บันทึก/เอาออกจาก preset (เขียนลง `config.json` ทันที) |
| **✕** | ลบเกมที่เพิ่มเองออกจาก `custom-games.json` (โชว์เฉพาะเกมที่มีป้าย `steam`) |
| **Start** | รัน executable ตัวแรก (ตัวที่ไม่ใช่ launcher) |
| **Stop** / **Stop all (N)** | หยุดทุก executable ของเกมนั้น |
| **▸** (หรือกดที่ชื่อเกม) | กางรายการ executable ทั้งหมด แล้ว Start/Stop ทีละตัวได้ |
| ป้าย `steam` | เกมที่เพิ่มเองจาก Steam ไม่ได้อยู่ในลิสต์ detectable ของ Discord |
| ป้าย `launcher` | executable ที่เป็นตัวปล่อยเกม — ถูกจัดไว้ท้ายสุดเสมอ |
| แถบสีซ้าย | เกมนั้นกำลังรันอยู่ |

**ปุ่ม Start รันแค่ตัวเดียวโดยเจตนา** เพราะ Discord แม็ปโปรเซสเข้ากับ application id เดียวของเกม
รันหลายตัวไม่ได้ progress เพิ่ม มีแต่เปลืองโปรเซส — ถ้าเผลอเปิดหลายตัว ปุ่มจะกลายเป็น
**Stop all (N)** ให้ปิดทีเดียว

### ช่องเพิ่มเกมจาก Steam

ช่อง `Game missing from Discord's list? Add it from Steam:` รับ SteamDB URL, Steam store URL
หรือ app id เปล่า ๆ — รายละเอียดทั้งหมดอยู่ที่ [เพิ่มเกมจาก Steam](TH-Steam-Games)

## อ่านต่อ

- [คำสั่ง command line](TH-CLI-Reference) — ทำทุกอย่างข้างบนโดยไม่เปิดเบราว์เซอร์
- [การตั้งค่า](TH-Configuration) — preset, พอร์ต, auto-stop เริ่มต้น
- [HTTP API](TH-HTTP-API) — endpoint ที่หน้าเว็บนี้เรียก
