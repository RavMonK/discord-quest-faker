# ความต่างของแต่ละระบบ

[🏠 หน้าแรก](Home) · **ไทย** · [English](EN-Platform-Notes)

---

## สรุปสั้น

| ระบบ | จำนวนเกมที่มี executable | placeholder มีหน้าต่างไหม | สถานะ |
|---|---|---|---|
| **Windows** | 10,447 | ✅ มี (ชั้น `compiled`) | ใช้งานได้เต็มรูปแบบ ทดสอบแล้ว |
| **macOS** | **62** | ❌ ไม่มี (`/bin/sleep`) | จำกัดมาก และยังไม่ได้ทดสอบบนเครื่องจริง |
| **Linux** | 8 | ❌ ไม่มี (`/bin/sleep`) | จำกัดมาก และยังไม่ได้ทดสอบบนเครื่องจริง |

โปรแกรมจะแสดง **เฉพาะเกมที่มี executable ของระบบที่กำลังรันอยู่** บน Mac จึงเห็นแค่ 62 เกมนั้น
ส่วนเกมที่มีแต่ฝั่ง Windows (เช่น MARVEL Tōkon) จะไม่ขึ้นมาเลย

## Windows

ทำงานได้ครบตามที่ออกแบบ:

- ชั้น `compiled` คอมไพล์ exe 5 KB ด้วย `csc.exe` (มาพร้อม .NET Framework) ที่ **เปิดหน้าต่างจริง**
  ซึ่งเป็นเงื่อนไขที่ Discord ต้องการ
- version info ของไฟล์ประกาศชื่อเกม ไม่ใช่ชื่อของไฟล์ระบบที่ยืมมา
- หยุดด้วย `taskkill /T /F` เพื่อให้โปรเซสลูกถูกปิดตามไปด้วย

หา `csc.exe` จากสองที่นี้:

```
%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
```

ถ้าไม่มีทั้งสองที่ โปรแกรมจะถอยไปใช้ชั้นที่ **ไม่มีหน้าต่าง** พร้อมพิมพ์ warning และมีโอกาสสูง
ที่ Discord จะตรวจไม่เจอ — ทางแก้คือติดตั้ง .NET Framework

## macOS / Linux

ต่างจาก Windows สองเรื่องใหญ่:

1. **ลิสต์ของ Discord ฝั่ง Unix เล็กมาก** — 62 เกมบน macOS และ 8 เกมบน Linux เทียบกับ
   10,447 บน Windows
2. **placeholder ไม่มีหน้าต่าง** — ใช้ `/bin/sleep` ที่ก๊อปมาเปลี่ยนชื่อ ถ้า Discord บน Mac
   ต้องการหน้าต่างแบบเดียวกับฝั่ง Windows วิธีนี้จะไม่ทำงาน — **ยังไม่ได้ทดสอบบนเครื่องจริง**

entry ฝั่ง macOS ที่เป็น `.app` จะได้ app bundle ขั้นต่ำมาให้ (มี `Info.plist` กับไฟล์ไบนารีใน
`Contents/MacOS/`) เพื่อให้ path ของโปรเซสลงท้ายด้วย `Foo.app/Contents/MacOS/Foo` เหมือนเกมจริง

## ทำไมไม่เปิดให้รันเกม Windows บน macOS

ในทางเทคนิคทำได้ — บน Unix นามสกุลไฟล์ไม่มีความหมาย จะสร้างและรันไฟล์ชื่อ `redsteam.exe` บน Mac
ก็ได้ **เคยทำแล้วและจงใจถอดออก** เพราะ:

> โปรเซสชื่อ `.exe` ที่รันอยู่บน macOS เป็นสิ่งที่เกิดขึ้นเองไม่ได้กับเกมจริง
> เท่ากับป้ายบอกชัด ๆ ว่ากำลังปลอม ซึ่งเป็น signal ที่ตรวจจับง่ายเกินไป — ความเสี่ยงไม่คุ้มกับที่ได้

`Spoofer.candidates()` จึงกรอง executable ของระบบอื่นออกทุกครั้ง **อย่านำกลับมาใส่**

## ตารางเทียบชั้น placeholder

| ชั้น | Windows | macOS / Linux |
|---|---|---|
| 1 `compiled` | `csc.exe` → exe มีหน้าต่าง 5 KB | ไม่มีชั้นนี้ |
| 2 `system` | ก๊อป `System32\waitfor.exe` + signal token เฉพาะตัว | ก๊อป `/bin/sleep 999999` |
| 3 `node` | ก๊อป `node.exe` + `keepalive.js` | ก๊อป `node` + `keepalive.js` (`chmod 755`) |
| วิธีหยุด | `taskkill /PID <pid> /T /F` | `SIGTERM` แล้วตามด้วย `SIGKILL` ใน 3 วินาที |

## คำสั่งตรวจสอบ (Windows)

โปรเซสปลอมรันจริงหรือเปล่า:

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like "*data\runtime*" } | Select-Object ProcessId, Name, ExecutablePath
```

โปรเซสนั้นเป็นเจ้าของหน้าต่างไหม (ค่าที่ไม่ใช่ 0 = มี):

```powershell
(Get-Process -Id <pid>).MainWindowHandle
```

ไฟล์ประกาศตัวเองว่าเป็นอะไร:

```powershell
(Get-Item <path>).VersionInfo
```

เก็บกวาดของค้างจากรอบก่อน (เซิร์ฟเวอร์ที่แครชอาจทิ้ง placeholder ไว้):

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like "*data\runtime*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

## อ่านต่อ

- [หลักการทำงาน](TH-How-It-Works) — เรื่องหน้าต่างและระบบ 3 ชั้น
- [แก้ปัญหา & FAQ](TH-Troubleshooting) — Discord ไม่ขึ้นว่าเล่นเกม
- [สถาปัตยกรรมโค้ด](TH-Architecture) — invariant ที่ห้ามแตะ
