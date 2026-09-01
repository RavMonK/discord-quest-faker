# ภาพรวมโปรเจกต์

[🏠 หน้าแรก](Home) · **ไทย** · [English](EN-Overview)

---

## นี่คืออะไร

**Discord Quest Faker** คือเครื่องมือที่รันบนเครื่องของคุณเอง ทำสองอย่าง:

1. **ดึงรายชื่อเกมที่ Discord ตรวจจับได้** จาก
   `https://discord.com/api/v10/applications/detectable` (~10,400 เกม) มาเก็บเป็นไฟล์ JSON
2. **สร้างโปรเซสปลอม** ที่มีชื่อไฟล์และ path ตรงกับ executable ของเกมนั้น แล้วรันทิ้งไว้
   Discord จึงมองว่าเกมนั้นกำลังรันอยู่ และ quest แบบ *"เล่นเกม X เป็นเวลา Y นาที"* เดินหน้าไปได้

ควบคุมทั้งหมดผ่านหน้าเว็บที่ <http://127.0.0.1:5011> บนเครื่องตัวเอง หรือผ่าน command line

<p align="center">
  <img src="https://raw.githubusercontent.com/RavMonK/discord-quest-faker/main/docs/screenshots/control-panel.png" alt="หน้าควบคุม Discord Quest Faker" width="820">
</p>

## จุดที่ควรรู้ก่อน

- ⚠️ **ขัดกับ Terms of Service ของ Discord** — quest อาจถูกยกเลิก รางวัลถูกเรียกคืน
  หรือบัญชีถูกจำกัด อ่าน [คำเตือนและความเสี่ยง](TH-Disclaimer) ให้จบก่อนใช้
- ใช้ได้เฉพาะ quest ประเภท **"เล่นเกม"** — quest ที่ต้อง **stream ให้เพื่อนดู** หรือ **ดูวิดีโอ**
  ทำแบบนี้ไม่ได้
- ต้องเปิด **Discord ตัว desktop** ไว้ (เวอร์ชันเว็บตรวจจับโปรเซสไม่ได้)
- ไม่แตะต้อง token, รหัสผ่าน หรือข้อมูลบัญชี Discord เลย — แค่รันโปรเซสบนเครื่องคุณ

## คุณสมบัติ

| อย่าง | รายละเอียด |
|---|---|
| ไม่มี dependency | Node.js ล้วน ๆ ไม่ต้อง `npm install` เลย |
| หน้าเว็บควบคุม | ค้นหาเกม, Start/Stop, preset, auto-stop, เพิ่มเกมจาก Steam |
| โปรเซสปลอมมีหน้าต่างจริง | คอมไพล์ exe 5 KB ด้วย `csc.exe` โชว์ไอคอนเกม + เวลาที่เดินมาแล้ว |
| ระบบ fallback 3 ชั้น | ถ้าชั้นบนใช้ไม่ได้ เลื่อนลงชั้นถัดไปเองอัตโนมัติ |
| preset | กด **★** บันทึกเกมลง `config.json` ครั้งต่อไปกดปุ่มเดียวรันได้ |
| auto-stop | ตั้งเวลาให้หยุดเองเป็นนาที |
| เกมนอกลิสต์ | เพิ่มเองได้จาก Steam app id / SteamDB URL |
| ข้ามแพลตฟอร์ม | Windows (เต็มรูปแบบ), macOS / Linux (จำกัด — ดู [ความต่างของแต่ละระบบ](TH-Platform-Notes)) |
| command line | รัน/ค้น/refresh ได้ทั้งหมดไม่ต้องเปิดเบราว์เซอร์ |

## ความต้องการ

- **Node.js 18 ขึ้นไป**
- **Discord เวอร์ชัน desktop** เปิดค้างไว้
- Windows: ควรมี **.NET Framework** (มีมาให้อยู่แล้วเกือบทุกเครื่อง) เพื่อให้มี `csc.exe`

ดูขั้นตอนละเอียดที่ [เริ่มต้นใช้งาน](TH-Getting-Started)

## โครงสร้างไฟล์

```
src/index.js        จุดเริ่มโปรแกรม + โหมด command line
src/config.js       อ่าน/เขียน config.json
src/games.js        ดึงลิสต์จาก Discord, cache, ค้นหา, รวมเกมที่เพิ่มเอง
src/steam.js        ดึง launch config จาก Steam appinfo
src/spoof.js        สร้างและรันโปรเซสเกมปลอม
src/server.js       HTTP API ของหน้าเว็บควบคุม
src/public/         หน้าเว็บควบคุม (HTML/CSS/JS ล้วน ไม่มี framework)
tests/              ชุดทดสอบ (node:test)
data/               cache รายชื่อเกม + ไฟล์ปลอม (gitignore)
config.json         การตั้งค่าและ preset ของคุณ (gitignore)
```

รายละเอียดหน้าที่ของแต่ละโมดูลอยู่ที่ [สถาปัตยกรรมโค้ด](TH-Architecture)

## อ่านต่อ

- [เริ่มต้นใช้งาน](TH-Getting-Started) — ติดตั้งและรันครั้งแรก
- [หลักการทำงาน](TH-How-It-Works) — Discord ตรวจจับเกมยังไง และเราหลอกมันยังไง
- [แก้ปัญหา & FAQ](TH-Troubleshooting) — Discord ไม่ขึ้นว่าเล่นเกม ทำไง

## License

[MIT](https://github.com/RavMonK/discord-quest-faker/blob/main/LICENSE) © 2026 RavMonK

แนวคิดการทำ placeholder ที่มีหน้าต่างจริง อ้างอิงจาก
[markterence/discord-quest-completer](https://github.com/markterence/discord-quest-completer)
