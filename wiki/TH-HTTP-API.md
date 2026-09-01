# HTTP API

[🏠 หน้าแรก](Home) · **ไทย** · [English](EN-HTTP-API)

---

หน้าเว็บควบคุมคุยกับเซิร์ฟเวอร์ผ่าน JSON API ใต้ `/api/` ทั้งหมด ส่วน `GET` อื่น ๆ ทั้งหมด
เสิร์ฟไฟล์ static จาก `src/public/`

**base URL** `http://127.0.0.1:5011` (เปลี่ยนตาม `host`/`port`)

> ⚠️ **API ไม่มีระบบยืนยันตัวตน** ค่าเริ่มต้นจึงผูกไว้ที่ `127.0.0.1` เท่านั้น ใครเข้าถึงได้
> ก็สั่งรัน/หยุดโปรเซสบนเครื่องนี้ได้ — คิดให้ดีก่อนเปลี่ยน `host`

รายละเอียดร่วม:

- body ที่ส่งเข้าต้องเป็น JSON และไม่เกิน **1 MB**
- ทุก response เป็น JSON พร้อม `Cache-Control: no-store`
- error ตอบ `{ ok: false, reason: "..." }`
- endpoint ที่ไม่รู้จักตอบ `404 { ok: false, reason: "unknown endpoint" }`

## `GET /api/state`

สถานะทุกอย่างที่หน้าเว็บต้องใช้ — หน้าเว็บเรียกอันนี้ทุก 5 วินาที

```json
{
  "os": "win32",
  "platform": "win32",
  "games": { "count": 10500, "custom": 1, "playableHere": 10447,
             "fetchedAt": "2026-09-01T12:00:00.000Z", "source": "api",
             "refreshing": false, "lastError": null, "file": "data/games.json" },
  "running": [ { "key": "356875221078245376::overwatch.exe", "id": "356875221078245376",
                 "gameId": "356875221078245376", "name": "Overwatch", "icon": "...",
                 "executable": "overwatch.exe", "path": "C:\\...\\overwatch.exe",
                 "pid": 12345, "startedAt": 1756728000000, "elapsedSeconds": 42,
                 "durationMinutes": 60, "restarts": 0, "placeholder": "compiled" } ],
  "presets": [ { "id": "...", "name": "Overwatch", "executable": "overwatch.exe",
                 "executables": [ { "name": "overwatch.exe", "os": "win32", "isLauncher": false } ],
                 "durationMinutes": 60, "icon": "...", "iconUrl": null,
                 "custom": false, "missing": false } ],
  "settings": { "defaultDurationMinutes": 0, "maxConcurrent": 12,
                "refreshIntervalMinutes": 720, "configFile": "config.json" }
}
```

`placeholder` บอกว่าใช้ชั้นไหน (`compiled` / `system` / `node`) — ไม่ใช่ `compiled` แปลว่า
**ไม่มีหน้าต่าง** และ Discord อาจตรวจไม่เจอ

## `GET /api/games`

| query | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `q` | `""` | คำค้น (ชื่อ, id, alias, ชื่อ executable — ตัด accent ให้) |
| `limit` | `100` | จำนวนต่อหน้า (เพดาน `500`) |
| `offset` | `0` | ข้ามไปกี่รายการ |
| `all` | — | `all=1` = เอาเกมของทุกระบบ ไม่ใช่แค่ระบบนี้ |

```json
{ "total": 37, "offset": 0,
  "items": [ { "id": "...", "name": "...", "icon": "...", "iconUrl": null,
               "custom": false, "source": "discord",
               "executables": [ { "name": "...", "os": "win32", "isLauncher": false } ] } ] }
```

`executables` เรียงลำดับเดียวกับที่ตัวรันใช้ (launcher ท้ายสุด) ดังนั้น `executables[0]` คือ
ตัวที่ Start ธรรมดาจะรัน

## `POST /api/start`

```json
{ "id": "356875221078245376", "executable": "overwatch.exe", "durationMinutes": 60 }
```

| field | รับค่าอะไร |
|---|---|
| `id` หรือ `name` | application id หรือชื่อเกม (resolve แบบหลวม) |
| `executable` | ไม่ใส่ = ตัวแรก · `"all"` · ชื่อไฟล์ · array ของชื่อ · เลข index |
| `durationMinutes` | auto-stop (ไม่ใส่ = `defaultDurationMinutes`) |

- `200` → `{ ok: true, sessions: [...], results: [...], running: [...] }`
- `404` → หาเกมไม่เจอ
- `409` → ไม่มี executable ไหนรันได้เลย (รันอยู่แล้ว / เกิน `maxConcurrent` / ไม่มี executable
  ของระบบนี้) — ดูเหตุผลของแต่ละตัวใน `results`

## `POST /api/stop`

```json
{ "key": "356875221078245376::overwatch.exe" }   // หยุด executable ตัวเดียว
{ "id": "356875221078245376" }                    // หยุดทุก executable ของเกมนั้น
```

`200` → `{ ok: true, running: [...] }` · `404` → ไม่ได้รันอยู่

## `POST /api/stop-all`

ไม่ต้องมี body → `{ ok: true, stopped: <จำนวน>, running: [] }`

## `POST /api/refresh`

ดึงลิสต์จาก Discord ใหม่ทันที

- `200` → `{ ok: true, count, fetchedAt, games }`
- `502` → `{ ok: false, reason, games }` (ลิสต์เดิมยังใช้ได้อยู่)

## `POST /api/custom`

```json
{ "input": "https://steamdb.info/app/3787240/config/", "force": false }
```

- **เพิ่มสำเร็จ** → `{ ok: true, added: true, game, note, games }`
- **Discord มีเกมนี้อยู่แล้ว** (และไม่ได้ส่ง `force`) →
  `{ ok: true, added: false, useInstead: { id, name, executables }, note, games }`
  — ไม่ใช่ error หน้าเว็บจะพาไปที่ entry ของ Discord ให้ (ดู [เพิ่มเกมจาก Steam](TH-Steam-Games))
- `400` → หา app id ไม่ได้ / Steam lookup ล้มเหลว / ไม่มี launch executable

## `DELETE /api/custom`

```json
{ "id": "steam:3787240" }
```

หยุดโปรเซสของเกมนั้นก่อน แล้วลบออกจาก `custom-games.json`
`200` → `{ ok: true, games, running }` · `404` → ไม่ใช่เกมที่เพิ่มเอง

## `POST /api/presets`

```json
{ "id": "356875221078245376", "executable": "overwatch.exe", "durationMinutes": 60 }
```

เพิ่ม preset ลง `config.json` (ถ้ามี id นั้นแล้วจะไม่ทำอะไร ตอบ `200` เฉย ๆ)

- `200` → `{ ok: true, presets: [...] }`
- `404` → หาเกมไม่เจอ
- `500` → `config.json` parse ไม่ผ่าน จึงไม่บันทึกให้ (ไฟล์ไม่ถูกแตะ)

## `DELETE /api/presets`

```json
{ "id": "356875221078245376" }
```

`200` → `{ ok: true, presets: [...] }` · `500` → เขียนไฟล์ไม่ได้ (เหตุผลเดียวกับด้านบน)

## ตัวอย่างใช้ด้วย curl

```bash
curl http://127.0.0.1:5011/api/state
curl "http://127.0.0.1:5011/api/games?q=overwatch&limit=5"
curl -X POST http://127.0.0.1:5011/api/start -H "Content-Type: application/json" -d '{"id":"356875221078245376"}'
curl -X POST http://127.0.0.1:5011/api/stop-all
```

## อ่านต่อ

- [สถาปัตยกรรมโค้ด](TH-Architecture) — โมดูลที่อยู่หลัง endpoint เหล่านี้
- [หน้าเว็บควบคุม](TH-Control-Panel) — ปุ่มไหนเรียก endpoint ไหน
- [คำสั่ง command line](TH-CLI-Reference) — ทางเลือกที่ไม่ต้องผ่าน HTTP
