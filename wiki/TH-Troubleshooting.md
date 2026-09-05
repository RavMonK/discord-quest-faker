# แก้ปัญหา & คำถามที่พบบ่อย

[🏠 หน้าแรก](Home) · **ไทย** · [English](EN-Troubleshooting)

---

## ปัญหาที่เจอบ่อย

| อาการ | วิธีแก้ |
|---|---|
| `node : command not found` | ยังไม่ได้ติดตั้ง Node.js หรือยังไม่ได้เปิดเทอร์มินัลใหม่หลังติดตั้ง |
| `port 5011 is already in use` | โปรแกรมจะบอกว่าโปรเซสไหนถือพอร์ตอยู่ (ชื่อ + pid) แล้วถามว่าจะ kill ทิ้งไหม — ตอบ `y` เพื่อยึดพอร์ต หรือ `n` แล้วเปลี่ยน `port` ใน `config.json` / รันด้วย `--port 8080` |
| หาโปรเซสใน Task Manager ไม่เจอ | ค้นในแท็บ **Details** ด้วยชื่อไฟล์ (แท็บ Processes ค้นจาก *ชื่อที่ไฟล์ประกาศตัวเอง* ไม่ใช่ชื่อไฟล์) |
| `config.json is not valid JSON` | ไฟล์พิมพ์ผิด — โปรแกรมจะไม่เขียนทับให้ แก้ไฟล์แล้วเปิดใหม่ |
| เกมที่ต้องการหาไม่เจอ | กด **Refresh list** หรือรัน `node src/index.js --refresh` |
| `csc.exe (.NET Framework) not found` | ติดตั้ง .NET Framework — ไม่งั้นได้ placeholder ที่ไม่มีหน้าต่างซึ่งมักตรวจไม่เจอ |
| `limit reached (maxConcurrent = 12)` | หยุดบางเกม หรือเพิ่มค่า `maxConcurrent` ใน `config.json` |
| `<เกม> has no win32 executable in the detectable list` | เกมนั้นไม่มี executable ของระบบนี้ (ดู [ความต่างของแต่ละระบบ](TH-Platform-Notes)) |

## Discord ไม่ขึ้นว่ากำลังเล่นเกม

ไล่เช็คตามลำดับนี้:

1. **ยืนยันก่อนว่าโปรเซสรันจริง** — เปิด Task Manager แท็บ **Details** (ไม่ใช่ Processes)
   แล้วหาชื่อไฟล์ เช่น `wwm.exe` หรือรัน:

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
   - **มี** = Discord เห็นโปรเซสแล้ว ปัญหาอยู่ที่ฝั่งการจับคู่/การตั้งค่า
   - **ไม่มี** = Discord ไม่ scan โปรเซสนั้นเลย → เช็คว่า placeholder **มีหน้าต่าง** หรือไม่:

     ```powershell
     (Get-Process -Id <pid>).MainWindowHandle
     ```

     ได้ `0` = ไม่มีหน้าต่าง แปลว่ากำลังใช้ชั้นสำรอง — ดูในเทอร์มินัลว่ามี warning
     `the ... placeholder has no window` ไหม แล้วติดตั้ง .NET Framework

## อ่าน log ในเทอร์มินัล

| บรรทัด | ความหมาย |
|---|---|
| `[spoof] started "<เกม>" as <exe> (pid N, compiled placeholder)` | เริ่มแล้ว และเป็นชั้นที่ดีที่สุด (มีหน้าต่าง) |
| `[spoof] ... the <tier> placeholder has no window` | ⚠️ ถอยไปใช้ชั้นสำรอง Discord อาจตรวจไม่เจอ |
| `[spoof] ... window closed - session ended` | ผู้ใช้ปิดหน้าต่างเอง — ถือว่าสั่งหยุด ไม่รีสตาร์ท |
| `[spoof] ... placeholder crashed unexpectedly (code=N)` | placeholder พังเอง ไม่ใช่ผู้ใช้ปิด |
| `[spoof] ... placeholder ended after Ns - restarting (#N)` | ชั้น `system`/`node` หมดเวลาแล้วถูกรันใหม่ (ปกติ) |
| `[games] refresh failed: ... - keeping cached list` | ดึงลิสต์ใหม่ไม่ได้ แต่ยังใช้ cache เดิมต่อได้ |
| `[config] preset "X": "all" -> <exe>` | preset เก่าที่เก็บ `"all"` ถูกแก้ให้เก็บ executable ตัวเดียว |

## คำถามที่พบบ่อย

**quest แบบ stream หรือดูวิดีโอทำได้ไหม**
ไม่ได้ วิธีนี้ปลอมได้แค่ "มีโปรเซสของเกมกำลังรัน" quest ที่ต้อง stream ให้เพื่อนดูหรือดูวิดีโอ
Discord ตรวจจากอย่างอื่น

**ต้องเปิด Discord ไว้ตลอดไหม**
ต้องเปิด ถ้าปิด Discord จะไม่มีใครเห็นโปรเซสปลอมนั้น

**รันหลายเกมพร้อมกันได้ไหม**
ได้ เพดานอยู่ที่ `maxConcurrent` (ค่าเริ่มต้น 12 นับแยกต่อ executable) แต่ Discord แสดงสถานะ
"กำลังเล่น" ได้ทีละเกม

**รัน executable หลายตัวของเกมเดียวกันแล้ว quest เดินเร็วขึ้นไหม**
ไม่ Discord แม็ปโปรเซสเข้ากับ application id หนึ่งอันต่อเกม — หน้าเว็บจึงรันแค่ตัวเดียว

**ต้องเลือก executable ตัวไหน**
ตัวไหนก็ได้ที่อยู่ในลิสต์ของ Discord ทดสอบแล้วทั้ง `cod.exe` และ `cod26-cod.exe` ต่างก็ได้
Modern Warfare 4 เหมือนกัน ไม่มีตัวที่ "ถูกต้อง"

**ปิดหน้าต่างโปรเซสปลอมแล้วจะเปิดใหม่ให้ไหม**
ไม่ ปิดหน้าต่าง = สั่งหยุด (ต่างจากชั้น `system`/`node` ที่หมดเวลาเองแล้วถูกรันใหม่)

**ลบ `data/` ได้ไหม**
ได้ ตอนที่ไม่มีอะไรรันอยู่ — ลิสต์เกมจะถูกดึงใหม่ ไฟล์ปลอมจะถูกสร้างใหม่ แต่
`data/custom-games.json` จะทำให้เกมที่เพิ่มเองหายไปด้วย

**โปรแกรมแตะ token หรือบัญชี Discord ไหม**
ไม่เลย ไม่มีการอ่าน ใช้ หรือส่ง credential ใด ๆ — แค่รันโปรเซสบนเครื่องคุณและเรียก HTTP GET
ไปที่ endpoint ลิสต์เกมสาธารณะของ Discord

**เกมที่เพิ่มจาก Steam นับ quest ไหม**
ไม่นับ — ดูเหตุผลที่ [เพิ่มเกมจาก Steam](TH-Steam-Games)

**โปรเซสปลอมค้างหลังโปรแกรมแครช ทำไง**
เก็บกวาดด้วยคำสั่งใน [ความต่างของแต่ละระบบ](TH-Platform-Notes) หรือเปิดโปรแกรมใหม่แล้วตอบ `y`
ตอนมันถามว่าจะ kill โปรเซสที่ถือพอร์ตอยู่ไหม (`taskkill /T` ปิดลูกให้ด้วย)

**เปิดหน้าเว็บจากเครื่องอื่นในบ้านได้ไหม**
ไม่ได้ โปรแกรมรับเฉพาะ loopback โดย `host` ต้องเป็น `127.0.0.1`, `localhost` หรือ `::1`
สคริปต์ที่เรียก API ต้องขอ session token และแนบ `X-DQF-Token` ดู [HTTP API](TH-HTTP-API)

## อ่านต่อ

- [หลักการทำงาน](TH-How-It-Works) — ทำไมเรื่องหน้าต่างสำคัญที่สุด
- [ความต่างของแต่ละระบบ](TH-Platform-Notes) — คำสั่งตรวจสอบ
- [การตั้งค่า](TH-Configuration) — `maxConcurrent`, พอร์ต, auto-stop
