# การตั้งค่า (config.json)

[🏠 หน้าแรก](Home) · **ไทย** · [English](EN-Configuration)

---

`config.json` อยู่ที่ราก repo และถูกสร้างให้อัตโนมัติในครั้งแรกที่รัน (ไฟล์นี้อยู่ใน `.gitignore`
เพราะเป็นข้อมูลของผู้ใช้ ไม่ใช่ source)

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
  "queue": [
    { "id": "356875221078245376", "name": "Overwatch", "executable": "overwatch.exe", "durationMinutes": 20 }
  ],
  "queueDelayMinSeconds": 30,
  "queueDelayMaxSeconds": 70,
  "autoStartPresets": false
}
```

## คำอธิบายแต่ละ key

| key | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `port` | `5011` | พอร์ตของหน้าเว็บควบคุม (ทับได้ด้วย `--port`) |
| `host` | `127.0.0.1` | เฉพาะ loopback: `127.0.0.1`, `localhost` หรือ `::1`; ค่าอื่นถูกปฏิเสธ |
| `openBrowser` | `true` | เปิดเบราว์เซอร์ให้อัตโนมัติ (`--headless` = ปิด) |
| `apiUrl` | endpoint ของ Discord | แหล่งของลิสต์ detectable |
| `gamesFile` | `data/games.json` | ที่เก็บ cache รายชื่อเกม |
| `customGamesFile` | `data/custom-games.json` | ที่เก็บเกมที่เพิ่มเอง |
| `refreshOnStart` | `true` | ดึงลิสต์ใหม่ทุกครั้งที่เปิด (แบบ background — ไม่ทำให้เปิดช้า) |
| `refreshIntervalMinutes` | `720` | ดึงลิสต์ซ้ำทุก ๆ กี่นาที (`0` = ไม่ดึงซ้ำ) |
| `runtimeDir` | `data/runtime` | ที่เก็บไฟล์ปลอม, ไอคอน และไฟล์ build |
| `defaultDurationMinutes` | `0` | auto-stop เริ่มต้น (`0` = รันจนกว่าจะสั่งหยุด) |
| `maxConcurrent` | `12` | จำนวนโปรเซสปลอมที่รันพร้อมกันได้ (นับแยกต่อ executable) |
| `presets` | `[]` | รายการเกมที่กดปุ่มเดียวรันได้ |
| `queue` | `[]` | คิวเกมที่เล่นต่อกันทีละตัว — ดูหัวข้อข้างล่าง |
| `queueDelayMinSeconds` | `30` | เวลารอน้อยสุดระหว่างสองรายการในคิว (วินาที) |
| `queueDelayMaxSeconds` | `70` | เวลารอมากสุดระหว่างสองรายการในคิว (วินาที) |
| `autoStartPresets` | `false` | รันทุก preset ทันทีที่เปิดโปรแกรม (เท่ากับ `--presets`) |

path ทุกอันคิดจากรากของ repo

## preset

แต่ละ preset มีหน้าตาแบบนี้:

```json
{ "id": "356875221078245376", "name": "Overwatch", "executable": "overwatch.exe", "durationMinutes": 60 }
```

| field | รับค่าอะไร |
|---|---|
| `id` | application id ของ Discord หรือ `steam:<appid>` ของเกมที่เพิ่มเอง |
| `name` | ป้ายที่โชว์ในหน้าเว็บ — ใช้หาเกมได้ด้วยถ้า `id` หาไม่เจอ |
| `executable` | ชื่อไฟล์ (`"lolex.exe"`), เลข index, array ของชื่อ หรือ `"all"` |
| `durationMinutes` | auto-stop ของ preset นี้ (`0` / ไม่ใส่ = รันจนกว่าจะสั่งหยุด) |

- ปุ่ม **★** ในหน้าเว็บจะบันทึกชื่อ executable ตัวที่ใช้อยู่ให้เอง
- **preset ควรเก็บ executable ตัวเดียว** ไม่ใช่ `"all"` — ถ้าเจอ `"all"` ในไฟล์ (จากเวอร์ชันเก่า)
  โปรแกรมจะเขียนทับให้เป็น executable ตัวแรกตอนเปิด พร้อมพิมพ์บรรทัดบอกในเทอร์มินัล
  เพราะรันหลายตัวไม่ได้ progress เพิ่มอยู่แล้ว
- ถ้า `id` ไม่มีในลิสต์ปัจจุบัน หน้าเว็บจะโชว์ปุ่ม **Not detectable** ที่กดไม่ได้

## คิว (queue)

คิวเล่น **ทีละรายการ** ตามเวลา `durationMinutes` ของแต่ละตัว แล้วรอแบบสุ่มเป็นวินาทีก่อนขึ้นตัวถัดไป
หน้าตาของแต่ละรายการเหมือน preset:

```json
{ "id": "356875221078245376", "name": "Overwatch", "executable": "overwatch.exe", "durationMinutes": 20 }
```

| field | รับค่าอะไร |
|---|---|
| `id` | application id ของ Discord หรือ `steam:<appid>` |
| `name` | ป้ายที่โชว์ในหน้าเว็บ — ใช้หาเกมได้ด้วยถ้า `id` หาไม่เจอ |
| `executable` | ชื่อ executable ตัวเดียว (คิวรันทีละตัวเสมอ) |
| `durationMinutes` | เล่นนานเท่าไหร่ **ถ้าเป็น `0` จะใช้ `defaultDurationMinutes` แทน และถ้าค่านั้นเป็น `0` ด้วย คิวจะค้างรอรายการนี้จนกว่าจะสั่งหยุดหรือกด Skip** |

`queueDelayMinSeconds` / `queueDelayMaxSeconds` คือช่วงเวลารอระหว่างรายการที่จบกับรายการถัดไป
ระบบ**สุ่มใหม่ทุกช่องว่าง** — ถ้าใช้ค่าคงที่ นั่นก็คือ pattern อีกแบบหนึ่ง ซึ่งเป็นสิ่งที่ช่วงสุ่มนี้มีไว้เลี่ยง
ทั้งสองค่าถูกบีบให้อยู่ในช่วง `0`–`3600` และถ้าใส่กลับด้าน (min มากกว่า max) ระบบจะสลับให้เอง
ไม่ใช่ปฏิเสธ

สั่งเริ่มคิวได้จากหน้าเว็บ หรือให้เริ่มตั้งแต่เปิดโปรแกรมด้วย `node src/index.js --queue`

## กฎการอ่าน/เขียนไฟล์ (สำคัญ)

โมดูล `src/config.js` มีสองกฎที่ตั้งใจใส่ไว้:

1. **ทน BOM** — editor บน Windows ชอบบันทึก JSON พร้อม UTF-8 BOM ซึ่ง `JSON.parse` ไม่รับ
   โปรแกรมจึงตัด BOM ให้ก่อน
2. **ไฟล์ที่ parse ไม่ผ่านจะไม่ถูกเขียนทับเด็ดขาด** — ถ้า `config.json` พิมพ์ผิด โปรแกรมจะรัน
   ด้วยค่า default พร้อมพิมพ์ error แล้ว**ปล่อยไฟล์ไว้เฉย ๆ** การกดบันทึก preset ในหน้าเว็บจะ
   ตอบกลับว่า `config.json is not valid JSON - fix it and restart` (ไม่งั้นการตั้งค่าทั้งหมด
   ของผู้ใช้จะหายไป)

### flag ไม่รั่วลงไฟล์

`--port` และ `--headless` แก้เฉพาะ config ที่อยู่ในหน่วยความจำ ตัวโหลดเก็บ snapshot ของ
"สิ่งที่ควรอยู่บนดิสก์" แยกไว้ (`fileState`) เพราะฉะนั้นตอนหน้าเว็บบันทึก preset ค่าพอร์ตชั่วคราว
จะไม่ถูกเขียนลง `config.json`

### เขียนกลับแค่บาง key

มีแค่ key เหล่านี้ที่หน้าเว็บเขียนกลับได้:

```
presets  ·  queue  ·  queueDelayMinSeconds  ·  queueDelayMaxSeconds
autoStartPresets  ·  defaultDurationMinutes  ·  maxConcurrent
```

ที่เหลือคงค่าตามที่อยู่บนดิสก์ และไฟล์ถูกเขียนแบบ atomic (เขียน `.tmp` แล้ว rename)

## ไฟล์ที่โปรแกรมสร้าง

```
data/games.json          รายชื่อเกมจาก Discord (~3 MB, ~10,400 เกม) — ลบได้ เดี๋ยวดึงใหม่
data/custom-games.json   เกมที่เพิ่มเองจาก Steam — ไม่ถูกเขียนทับตอน refresh
data/runtime/            ไฟล์ปลอมของแต่ละเกม — ลบได้ตอนไม่ได้รันอยู่
data/runtime/_build/     ซอร์ส C# และไฟล์ stamp ที่ใช้ตัดสินว่าต้อง build ใหม่ไหม
data/runtime/_icons/     ไอคอนเกมที่โหลดมาแล้ว
data/runtime/keepalive.js สคริปต์ของ placeholder ชั้น node
config.json              ตั้งค่า, preset และคิวของคุณ
```

`data/` และ `config.json` อยู่ใน `.gitignore` — เป็น state ของผู้ใช้ ไม่ใช่ source
โปรเซสปลอมทุกตัวจะถูกปิดให้อัตโนมัติเมื่อปิดโปรแกรม

## อ่านต่อ

- [คำสั่ง command line](TH-CLI-Reference) — flag ที่ไปทับค่าเหล่านี้
- [หน้าเว็บควบคุม](TH-Control-Panel) — ปุ่มที่แก้ไฟล์นี้
- [สถาปัตยกรรมโค้ด](TH-Architecture) — เหตุผลเบื้องหลังกฎข้างบน
