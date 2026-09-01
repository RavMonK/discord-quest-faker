# Discord Quest Faker — Wiki

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/RavMonK/discord-quest-faker/blob/main/LICENSE)
[![Node.js >= 18](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](https://github.com/RavMonK/discord-quest-faker/blob/main/package.json)

เครื่องมือบนเครื่องตัวเองที่สร้าง "โปรเซสเกมปลอม" ให้ Discord ตรวจจับว่ากำลังเล่นเกมนั้นอยู่
เพื่อให้ quest แบบ *"เล่นเกม X เป็นเวลา Y นาที"* เดินหน้า — Node.js ล้วน ไม่มี dependency

A local tool that spawns placeholder processes impersonating a game's executable, so Discord's
game detection reports the game as running and *"play game X"* quests progress. Pure Node.js,
zero npm dependencies.

---

## เลือกภาษา / Choose your language

<table>
<tr>
<td width="50%" valign="top">

### 🇹🇭 ภาษาไทย

**เริ่มที่นี่**
- [ภาพรวมโปรเจกต์](TH-Overview)
- [เริ่มต้นใช้งาน](TH-Getting-Started)
- [หลักการทำงาน](TH-How-It-Works)

**คู่มือใช้งาน**
- [หน้าเว็บควบคุม](TH-Control-Panel)
- [คำสั่ง command line](TH-CLI-Reference)
- [การตั้งค่า (config.json)](TH-Configuration)
- [เพิ่มเกมจาก Steam](TH-Steam-Games)
- [ความต่างของแต่ละระบบ](TH-Platform-Notes)
- [แก้ปัญหา & คำถามที่พบบ่อย](TH-Troubleshooting)

**สำหรับนักพัฒนา**
- [สถาปัตยกรรมโค้ด](TH-Architecture)
- [HTTP API](TH-HTTP-API)
- [การพัฒนาและทดสอบ](TH-Development)

**สำคัญ**
- [⚠️ คำเตือนและความเสี่ยง](TH-Disclaimer)

</td>
<td width="50%" valign="top">

### 🇬🇧 English

**Start here**
- [Project overview](EN-Overview)
- [Getting started](EN-Getting-Started)
- [How it works](EN-How-It-Works)

**User guide**
- [Control panel](EN-Control-Panel)
- [CLI reference](EN-CLI-Reference)
- [Configuration (config.json)](EN-Configuration)
- [Adding Steam games](EN-Steam-Games)
- [Platform notes](EN-Platform-Notes)
- [Troubleshooting & FAQ](EN-Troubleshooting)

**For developers**
- [Architecture](EN-Architecture)
- [HTTP API](EN-HTTP-API)
- [Development & testing](EN-Development)

**Important**
- [⚠️ Disclaimer & risks](EN-Disclaimer)

</td>
</tr>
</table>

---

## เริ่มเร็วสุด / Quickest start

```bash
node src/index.js
```

เปิด <http://127.0.0.1:5011> → ค้นชื่อเกม → กด **Start**
Open <http://127.0.0.1:5011> → search a game → press **Start**.

---

> ⚠️ **อ่านก่อนใช้** โปรแกรมนี้ขัดกับ Terms of Service ของ Discord และอาจทำให้ quest ถูกยกเลิก
> รางวัลถูกเรียกคืน หรือบัญชีถูกจำกัดได้ — [รายละเอียด](TH-Disclaimer)
>
> ⚠️ **Read first.** This tool violates Discord's Terms of Service and may get quests voided,
> rewards revoked, or your account limited — [details](EN-Disclaimer)
