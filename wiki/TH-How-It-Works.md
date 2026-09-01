# หลักการทำงาน

[🏠 หน้าแรก](Home) · **ไทย** · [English](EN-How-It-Works)

---

## Discord ตรวจจับเกมยังไง

Discord desktop ไล่ดู **path ของโปรเซสที่กำลังรันอยู่** บนเครื่อง แล้วเทียบกับรายการ `executables`
ในลิสต์ detectable ของมันเอง เช่น:

| เกม | executable ในลิสต์ |
|---|---|
| Overwatch | `overwatch.exe` |
| League of Legends | `garenalolth/gamedata/apps/lolth/lolex.exe` |
| World of Warcraft | `_retail_/wow-64.exe` |

ถ้าเจอโปรเซสที่ path ลงท้ายตรงกับรายการนั้น Discord จะแม็ปโปรเซสนั้นเข้ากับ **application id**
ของเกม แล้วขึ้นสถานะ "กำลังเล่น" — และ quest ก็เดินตามนั้น

โปรแกรมนี้จึงแค่สร้างไฟล์ที่มี **ชื่อและโครงสร้างโฟลเดอร์ตรงตามนั้น** แล้วรันทิ้งไว้

## ระบบ 3 ชั้น (fallback chain)

`Spoofer.tiers()` ไล่ลองทีละชั้นตามลำดับความน่าเชื่อถือ ถ้าชั้นไหนใช้ไม่ได้จะเลื่อนไปชั้นถัดไป
ให้เองอัตโนมัติ:

| ลำดับ | ชื่อชั้น | แพลตฟอร์ม | วิธีสร้างไฟล์ | ขนาด | RAM | หน้าต่าง |
|---|---|---|---|---|---|---|
| 1 | `compiled` | Windows | คอมไพล์ exe จริงด้วย `csc.exe` | 5 KB | ~20 MB | ✅ มี |
| 2 | `system` | Windows | ก๊อป `System32\waitfor.exe` | 64 KB | ~6 MB | ❌ ไม่มี |
| 2 | `system` | macOS / Linux | ก๊อป `/bin/sleep` | ~150 KB | ~2 MB | ❌ ไม่มี |
| 3 | `node` | ทุกแพลตฟอร์ม | ก๊อป `node` ตัวที่กำลังรัน + `keepalive.js` | ~90 MB | ~35 MB | ❌ ไม่มี |

ชั้นที่ throw error หรือโปรเซสตายภายใน 2 วินาที จะถูกนับว่าใช้ไม่ได้และเลื่อนลงชั้นถัดไปทันที

## สำคัญที่สุด: ต้องมีหน้าต่างจริง

**Discord ไม่ได้ดูแค่ชื่อโปรเซส — มันมองหาโปรเซสที่เป็นเจ้าของหน้าต่างที่มองเห็นได้ด้วย**
โปรเซสที่รันเงียบ ๆ ไม่มีหน้าต่าง จะไม่ถูกตรวจจับถึงแม้ชื่อไฟล์จะตรงเป๊ะก็ตาม

placeholder ชั้นที่ 1 จึงเปิด **หน้าต่าง WinForms จริงพร้อม message loop** โดยตั้ง title เป็นชื่อเกม
และถูก spawn ด้วย `windowsHide: false` (แนวทางเดียวกับ
[discord-quest-completer](https://github.com/markterence/discord-quest-completer)
ที่ใช้ `CreateWindowExW` + `ShowWindow(hWnd, SW_SHOWNORMAL)` + message loop ใน WinAPI)

<p align="center">
  <img src="https://raw.githubusercontent.com/RavMonK/discord-quest-faker/main/docs/screenshots/placeholder-window.png" alt="หน้าต่างโปรเซสปลอมของ Overwatch" width="440">
</p>

> **ปิดหน้าต่าง = หยุดเกมนั้น** เหมือนกดปุ่ม Stop ในหน้าเว็บ โปรแกรมจะไม่เปิดขึ้นมาใหม่ให้

⚠️ ชั้นที่ 2 และ 3 **ไม่มีหน้าต่าง** จึงมีโอกาสสูงที่ Discord จะตรวจไม่เจอ — ถ้าถอยไปใช้ชั้นเหล่านั้น
จะขึ้น warning ในเทอร์มินัลให้เห็น ทางแก้คือติดตั้ง .NET Framework เพื่อให้มี `csc.exe`

## ทำไมไม่ก๊อปไฟล์ระบบมาเฉย ๆ

นอกจากเรื่องหน้าต่าง ไฟล์ที่ก๊อปมายัง **ฝังตัวตนเดิมไว้ข้างใน** — `waitfor.exe` ที่เปลี่ยนชื่อเป็น
`wwm.exe` ยังบอก Windows ว่าตัวเองคือ *"waitfor - wait/send a signal over a network" ของ
Microsoft Corporation*

ผลข้างเคียงที่เจอจริง: Task Manager แท็บ Processes โชว์ชื่อที่ไฟล์ประกาศตัวเอง ทำให้ค้น `wwm`
ไม่เจอทั้งที่โปรเซสรันอยู่ (ต้องไปค้นในแท็บ **Details** ด้วยชื่อไฟล์)

exe ที่คอมไพล์เองแก้ปัญหานี้: ฝังชื่อเกมไว้ใน assembly attributes และคอมไพล์ตรงไปที่ path
สุดท้ายเลย ทำให้ `FileDescription`, `ProductName` และ `OriginalFilename` ตรงกับเกมและชื่อไฟล์จริง

เช็คได้เองด้วย PowerShell:

```powershell
(Get-Item <path ของไฟล์ปลอม>).VersionInfo
```

## ต้องตรงทั้งหาง path ไม่ใช่แค่ชื่อไฟล์

entry อย่าง `_retail_/wow-64.exe` หรือ `garenalolth/gamedata/apps/lolth/lolex.exe`
ต้องสร้างโฟลเดอร์นำหน้าขึ้นมาใหม่ด้วย ใต้ `data/runtime/<game id>/`:

```
data/runtime/356875221078245376/overwatch.exe
data/runtime/1402418696126992445/garenalolth/gamedata/apps/lolth/lolex.exe
```

ฝั่ง macOS entry ที่ลงท้าย `.app` จะได้ app bundle ขั้นต่ำมาให้ เพื่อให้ path ของโปรเซสลงท้ายด้วย
`Foo.app/Contents/MacOS/Foo` เหมือนเกมจริง

## หน้าต่างรู้ได้ยังไงว่าต้องโชว์อะไร

ทุกอย่างที่หน้าต่างแสดง (ไอคอนเกม, เวลาที่เดินมาแล้ว, เวลาที่เหลือก่อน auto-stop) ส่งเข้าไป
เป็น **command line arguments** ไม่ได้คอมไพล์ติดมา:

```
<ไฟล์ปลอม> --icon <path|-> --started <epoch ms> --duration <minutes>
```

เพราะแบบนี้ **build เดียวใช้ได้ทุก session** และไม่ต้องคอมไพล์ใหม่ทุกครั้งที่กด Start
(คอมไพล์ครั้งแรก ~0.8 วินาที แล้ว cache ไว้ — ตัดสินว่าจะ build ใหม่ไหมจากไฟล์ stamp
ที่เก็บชื่อเกม, `PLACEHOLDER_BUILD` และขนาดไฟล์)

ไอคอนโหลดจาก CDN ของ Discord/Steam **แบบ background** และคืน path กลับมาทันที
หน้าต่างจะคอยเช็คไฟล์นั้นทุกวินาทีนาน ~90 วินาที ถ้ายังไม่มาก็โชว์ตัวอักษรแรกของชื่อเกมแทน —
**กด Start แล้วต้องไม่รอเน็ตเด็ดขาด** ไอคอนที่โหลดแล้วเก็บใน `data/runtime/_icons/`

## นโยบายการรีสตาร์ท (ต่างกันตามชั้น)

| ชั้น | โปรเซสจบเองเมื่อ | โปรแกรมทำอะไร |
|---|---|---|
| `compiled` | ผู้ใช้ปิดหน้าต่าง | **ไม่รีสตาร์ท** — ถือว่าผู้ใช้สั่งหยุด |
| `system` | `waitfor` หมดเวลา (สูงสุด 99999 วินาที) / `sleep` ครบกำหนด | **รีสตาร์ทให้** เพื่อให้ session อยู่จนกดหยุด |
| `node` | ไม่จบเอง (แต่ถ้าจบ) | **รีสตาร์ทให้** |

เพดานการรีสตาร์ทอยู่ที่ 500 ครั้ง (`MAX_RESTARTS`) กันกรณี placeholder พังถาวรแล้ววนไม่หยุด

## ข้อจำกัดเชิงหลักการ

- Discord แม็ปโปรเซสเข้ากับ application id **หนึ่งอัน** ต่อเกม — รัน executable หลายตัวของเกม
  เดียวกันพร้อมกันจึง**ไม่ได้ progress เพิ่ม** หน้าเว็บจึงจงใจรันแค่ตัวเดียว
- **executable ตัวไหนในลิสต์ก็ใช้ได้** ไม่มีตัวที่ "ถูกต้อง" — ทดสอบแล้วทั้ง `cod.exe` และ
  `cod26-cod.exe` ก็ได้ Modern Warfare 4 เหมือนกัน
- เกมที่ **ไม่มีในลิสต์ detectable** หลอกไม่ได้ (ดู [เพิ่มเกมจาก Steam](TH-Steam-Games)
  ว่าทำได้แค่ไหน)

## อ่านต่อ

- [สถาปัตยกรรมโค้ด](TH-Architecture) — โมดูลไหนทำอะไร invariant มีอะไรบ้าง
- [ความต่างของแต่ละระบบ](TH-Platform-Notes) — ทำไม macOS ทำได้น้อยกว่ามาก
- [แก้ปัญหา & FAQ](TH-Troubleshooting) — ตรวจว่าโปรเซสรันจริงไหม
