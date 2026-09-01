# คำสั่ง command line

[🏠 หน้าแรก](Home) · **ไทย** · [English](EN-CLI-Reference)

---

ทุกอย่างที่ทำในหน้าเว็บได้ ทำจาก command line ได้เหมือนกัน — เหมาะกับการเขียน script

```bash
node src/index.js --help
```

## flag ทั้งหมด

| flag | ความหมาย |
|---|---|
| *(ไม่ใส่อะไร)* | เปิดหน้าเว็บควบคุมและเปิดเบราว์เซอร์ให้ |
| `--headless` | เปิดหน้าเว็บควบคุมแต่ไม่เปิดเบราว์เซอร์ (ใช้เวลาสั่งจาก script) |
| `--port <n>` | ทับค่า `port` ใน `config.json` (ไม่เขียนลงไฟล์) |
| `--refresh` | ดึง `data/games.json` ใหม่แล้วออกจากโปรแกรม |
| `--add-steam <id\|url>` | เพิ่มเกมที่ไม่มีในลิสต์ Discord จาก Steam app config |
| `--force` | ใช้ร่วมกับ `--add-steam`: บันทึก entry ของ Steam ทั้งที่ Discord มีอยู่แล้ว |
| `--list [query]` | พิมพ์เกมที่ตรงคำค้น (เฉพาะที่รันได้บนระบบนี้) แล้วออก |
| `--start <name\|id>` | รันเกมจาก command line (Ctrl+C เพื่อหยุด) |
| `--exe all\|<name>\|<n>` | เลือกว่าจะรัน executable ตัวไหน (ไม่ใส่ = ตัวแรก) |
| `--duration <minutes>` | หยุดอัตโนมัติหลังกี่นาที (ใช้กับ `--start`) |
| `--presets` | รันทุก preset ใน `config.json` ทันทีที่เปิดโปรแกรม |
| `--help` | แสดงวิธีใช้ |

รับได้ทั้งรูปแบบ `--port 8080` และ `--port=8080`

## ตัวอย่างที่ใช้บ่อย

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
node src/index.js --presets                  # รันทุก preset ทันทีที่เปิด
```

npm script ที่มีให้:

```bash
npm start        # = node src/index.js
npm run headless # = node src/index.js --headless
npm run refresh  # = node src/index.js --refresh
npm test         # ชุดทดสอบ (node:test)
```

## `--list` และเลข index

`--list` แสดง executable ทั้งหมดพร้อมเลข index ที่ใช้กับ `--exe` ได้ (สูงสุด 40 เกมต่อครั้ง):

```
  League of Legends                             1402418696126992445
      [0] garenalolth/gamedata/apps/lolth/lolex.exe
      [1] league of legends.exe
      [2] garenaloltw/gamedata/apps/loltw/lol.exe
      [3] leagueclientux.exe  (launcher)
```

- เรียงลำดับเดียวกับที่ตัวรันใช้ — **launcher อยู่ท้ายสุดเสมอ** ดังนั้น `[0]` คือตัวที่ Start
  ธรรมดาจะรัน
- แสดงเฉพาะ executable ของ**ระบบที่กำลังรันอยู่** (ดู [ความต่างของแต่ละระบบ](TH-Platform-Notes))
- `--list` เปล่า ๆ ไม่ใส่คำค้นก็ได้

## `--start` หาเกมยังไง

`--start` รับทั้ง application id และชื่อ โดยไล่หาตามลำดับ:

1. ตรงกับ application id
2. ชื่อเกมตรงเป๊ะ (ตัดตัวพิมพ์เล็กใหญ่และ accent)
3. alias ตรงเป๊ะ
4. ชื่อ executable ตรงเป๊ะ
5. ชื่อเกมมีคำค้นนั้นอยู่ข้างใน

จึงใช้ `--start "Overwatch"` หรือ `--start 356875221078245376` ก็ได้ผลเหมือนกัน

## `--exe` รับค่าอะไรได้

| ค่า | ผล |
|---|---|
| ไม่ใส่ | executable ตัวแรก (ตัวที่ไม่ใช่ launcher) |
| `all` | ทุก executable ของเกมนั้น — **ปกติไม่ต้องใช้** (ไม่ทำให้ quest เดินเร็วขึ้น) |
| ชื่อไฟล์ | เช่น `--exe "cod26-cod.exe"` (ตรงเป๊ะ ไม่สนตัวพิมพ์) |
| เลข index | เช่น `--exe 2` — เลขจาก `--list` |

## พฤติกรรมตอนรัน `--start`

- โปรแกรมค้างอยู่จนกว่าโปรเซสปลอมจะหยุด แล้วพิมพ์ `[cli] finished.`
- **Ctrl+C** ปิดโปรแกรมและปิดโปรเซสปลอมทุกตัวที่มันสร้าง (รวมถึง SIGTERM/SIGHUP)
- ถ้าไม่มี cache รายชื่อเกมอยู่เลย `--list` และ `--start` จะดึงลิสต์ให้ก่อนอัตโนมัติ

## พอร์ตไม่ว่าง

ถ้าพอร์ตถูกใช้อยู่ โปรแกรมจะบอกชื่อและ pid ของโปรเซสที่ถืออยู่ แล้ว**ถามว่าจะ kill ทิ้งไหม**
จากนั้นลอง `listen()` ใหม่

> จะถามเฉพาะตอนรันในเทอร์มินัลจริง (`process.stdin.isTTY`) — สั่งจาก script (เช่น `--headless`
> ใน CI) จะไม่ kill อะไรที่ไม่มีใครอนุมัติ แต่จะพิมพ์ pid ให้ไปจัดการเอง

บน Windows kill ด้วย `taskkill /T` ดังนั้นโปรเซสปลอมที่หน้าเว็บเดิมสร้างไว้ (ซึ่งเป็นลูกของมัน)
จะถูกปิดตามไปด้วย

## อ่านต่อ

- [การตั้งค่า](TH-Configuration) — ค่าที่ flag เหล่านี้ไปทับ
- [เพิ่มเกมจาก Steam](TH-Steam-Games) — `--add-steam` และ `--force` ละเอียด ๆ
- [หน้าเว็บควบคุม](TH-Control-Panel) — เทียบกับฝั่ง UI
