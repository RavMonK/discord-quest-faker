# ความต่างของแต่ละระบบ

[🏠 หน้าแรก](Home) · **ไทย** · [English](EN-Platform-Notes)

---

## สรุปสั้น

| ระบบ | จำนวนเกมที่มี executable | placeholder มีหน้าต่างไหม | สถานะ |
|---|---|---|---|
| **Windows** | 10,447 | ✅ มี (ชั้น `compiled`) | ใช้งานได้เต็มรูปแบบ ทดสอบแล้ว |
| **macOS** | **62** | ✅ มี (ชั้น `compiled`) | ต้องมี Xcode CLT · ครบทุกสัญญาณที่ Discord อ่านได้ แต่ยังไม่ยืนยันว่านับ quest ให้ |
| **Linux** | 8 | ✅ มี (ชั้น `compiled`) | ต้องมี C compiler และ session ของ X/XWayland · ยืนยันแล้วว่าหน้าต่างขึ้นจริงบน X11 แต่ยังไม่ยืนยันว่า Discord นับ quest ให้ |

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
2. **ชั้น `compiled` ของ macOS ต้องมี Xcode Command Line Tools** — ใช้ `clang` + Cocoa SDK
   ถ้าไม่มีจะตกไปใช้ชั้น `node` ที่ **ไม่มีหน้าต่าง** และโปรแกรมจะเตือนพร้อมบอกให้รัน
   `xcode-select --install`
3. **ชั้น `compiled` ของ Linux ต้องมี C compiler กับจอ** — `cc`, `gcc` หรือ `clang` ตัวใดก็ได้
   (หรือตัวที่ `$CC` ชี้ไว้) และต้องมี `DISPLAY` ที่ชี้ไป session ของ X หรือ XWayland ถ้าขาดอย่างใด
   อย่างหนึ่งจะถอยไปใช้ชั้น `system` ที่ **ไม่มีหน้าต่าง** โดย warning จะบอกว่าขาดฝั่งไหน

entry ฝั่ง macOS ที่เป็น `.app` จะได้ app bundle ขั้นต่ำมาให้ (มี `Info.plist` กับไฟล์ไบนารีใน
`Contents/MacOS/`) เพื่อให้ path ของโปรเซสลงท้ายด้วย `Foo.app/Contents/MacOS/Foo` เหมือนเกมจริง

### หน้าต่างบน macOS

`compileMac()` คอมไพล์แอป Cocoa จริงขนาด ~56 KB ด้วย `clang` ลงไปที่ path ปลอมตรงๆ แอปนั้นรัน
`NSApplication` ด้วย activation policy `Regular` และเปิด `NSWindow` ค้างไว้ (แสดงชื่อเกม ไอคอน
เวลาที่ผ่านไป และเวลาที่จะหยุดเอง) — ปิดหน้าต่าง = จบ session เหมือนฝั่ง Windows

`discord_utils.node` ของ Discord import ทั้ง `proc_pidpath`, `sysctl`, `proc_pidinfo`,
`NSWorkspace`/`NSRunningApplication` และ `CGWindowListCopyWindowInfo` — ชั้น `compiled` ตอบได้
ครบสามอย่างที่สำคัญ:

| สัญญาณ | ชั้น `compiled` | ชั้น `node` |
|---|---|---|
| `proc_pidpath()` = path ปลอมของเกม | ✅ | ✅ |
| `lsappinfo` / NSWorkspace เห็นเป็นแอป (`type="Foreground"`) | ✅ | ❌ |
| `CGWindowListCopyWindowInfo` เจอหน้าต่าง on-screen layer 0 | ✅ | ❌ |

### บน macOS ไม่ใช้ `/bin/sleep` แล้ว

เคยใช้ แล้วพังเสมอ: macOS ผูก *launch constraint* ไว้กับไบนารีของ Apple เอง ก๊อป `/bin/sleep`
ไปวางที่อื่นแล้วรัน ระบบจะ SIGKILL ทิ้ง (วัดได้ตั้งแต่ 4 ถึง 113 วินาทีหลังเริ่ม) พร้อมบันทึกเหตุผลไว้ที่
`~/Library/Logs/DiagnosticReports/` ว่า `CODESIGNING` / `Launch Constraint Violation`
ชั้น `system` จึงถูกตัดออกจาก macOS และเหลือชั้น `node` ชั้นเดียว — ไบนารีของ Node ไม่มีข้อผูกนี้
จึงรันค้างได้ไม่จำกัด (ทดสอบยาวสุด 5 นาทีเต็ม ไม่ตาย)

อีกสองข้อที่ macOS บังคับไว้ และห้ามแก้กลับ:

- **ห้าม hard link บน macOS** ต้องก๊อปไฟล์จริง ๆ เพราะ hard link ใช้ inode ร่วมกับ Node ตัวจริง
  แล้ว `proc_pidpath()` (ฟังก์ชันที่ Discord ใช้อ่าน path ของโปรเซส) จะตอบชื่อไหนก็ได้ของ inode นั้น
  วัดจากตัวเดียวกันได้ทั้ง path ปลอมที่ถูกต้อง และ `.../node/bin/node` — ถ้าตอบอย่างหลัง Discord
  จะเห็นโปรเซสชื่อ `node` แล้วตรวจไม่เจอ
- **ห้ามเขียน `Info.plist` ทับ** ถ้าเนื้อหาไม่เปลี่ยน เพราะพอ macOS launch bundle ไปแล้วมันจะแปะ
  `com.apple.provenance` และ App Management protection จะปฏิเสธการเขียนทุกอย่างข้างใน `.app`
  (เป็น `EPERM` แม้จะ unlink ก่อนก็ตาม) ลบทั้ง bundle ยังทำได้ ซึ่งใช้เป็นทางออกเวลาต้องเปลี่ยน plist จริง ๆ

### หน้าต่างบน Linux

`compileLinux()` คอมไพล์โปรแกรม X11 ขนาด ~72 KB ด้วย compiler อะไรก็ได้ที่มีในเครื่อง ลงไปที่
path ปลอมตรง ๆ แล้วเปิดหน้าต่างขนาดคงที่ 480x160 หนึ่งบาน แสดงชื่อเกม, ชื่อ executable ที่กำลัง
สวมรอย, เวลาที่เดินมาแล้ว และเวลาที่จะหยุดเอง — ปิดหน้าต่าง = จบ session เหมือน Windows กับ macOS

สองเรื่องที่ทำให้ชั้นนี้เบาพอจะเป็นชั้นแรกได้:

- **เรียก Xlib ผ่าน `dlopen` ไม่ได้ link** ทุกฟังก์ชันถูก lookup ด้วยชื่อตอนรัน จึงไม่ต้องมี header
  ของ X11, ไม่ต้องมี dev package และไม่ต้อง `-lX11` — ขอแค่ compiler ส่วน `libX11.so.6` มีอยู่แล้ว
  ในทุกเครื่องที่รัน session ของ X หรือ XWayland
- **สิ่งที่คอมไพล์ติดไปมีแค่ข้อความ** ชื่อเกม, ป้ายชื่อ และชื่อไฟล์กลายเป็น string constant ส่วนนาฬิกา
  กับเวลาหยุดเองส่งเข้าไปทาง command line จึงคอมไพล์ครั้งเดียวใช้ได้ทุก session ของเกมนั้น และถูก cache ไว้

สิ่งที่ทำไม่ได้คือแสดงรูปเกม เพราะการ decode PNG ต้องมี library ซึ่งชั้นนี้ไม่มีเลย จึงแสดงตัวอักษรแรก
ของชื่อเกมแทน และบน Linux ไม่ดาวน์โหลดไอคอนตั้งแต่แรก ข้อความที่วาดยังถูกพับให้เป็น ASCII ด้วย
(`MARVEL Tōkon` → `MARVEL Tokon`) เพราะ core font ของ X เป็นแบบ single byte — ชื่อจริงบนแถบ
หัวหน้าต่างส่งผ่าน `_NET_WM_NAME` เป็น UTF-8 จึงยังมีวรรณยุกต์ครบ

หน้าต่างยังพา property ที่หน้าต่างของแอปจริงพาไปด้วย: `WM_CLASS` (ชื่อ executable กับชื่อเกม),
`_NET_WM_PID` (pid ของตัวเอง) และ `WM_DELETE_WINDOW` เพื่อให้ window manager "ขอ" ให้ปิด
แทนที่จะฆ่าทิ้ง

**ยืนยันอะไรแล้ว และอะไรยัง** บน X11 หน้าต่างขึ้นจริง — map แล้ว ขนาด 480x160 ชื่อและ class ตรงกับเกม
`_NET_WM_PID` ตรงกับ pid ของ placeholder และ `/proc/<pid>/exe` เป็น path ปลอมของเกม ส่วนที่ว่า
Discord ฝั่ง Linux **นับ quest ให้หรือไม่ยังไม่ยืนยัน** เหมือนกับ macOS การตรวจจับฝั่ง Linux ของ
Discord อ่าน `/proc` ซึ่งชั้นที่ไม่มีหน้าต่างก็ตอบได้ หน้าต่างจึงมีไว้เพราะทุกแพลตฟอร์มที่ผ่านมาต้องการมัน
และเพราะ session ที่มองไม่เห็นคือ session ที่ลืมกดหยุด

## ทำไมไม่เปิดให้รันเกม Windows บน macOS

ในทางเทคนิคทำได้ — บน Unix นามสกุลไฟล์ไม่มีความหมาย จะสร้างและรันไฟล์ชื่อ `redsteam.exe` บน Mac
ก็ได้ **เคยทำแล้วและจงใจถอดออก** เพราะ:

> โปรเซสชื่อ `.exe` ที่รันอยู่บน macOS เป็นสิ่งที่เกิดขึ้นเองไม่ได้กับเกมจริง
> เท่ากับป้ายบอกชัด ๆ ว่ากำลังปลอม ซึ่งเป็น signal ที่ตรวจจับง่ายเกินไป — ความเสี่ยงไม่คุ้มกับที่ได้

`Spoofer.candidates()` จึงกรอง executable ของระบบอื่นออกทุกครั้ง **อย่านำกลับมาใส่**

## ตารางเทียบชั้น placeholder

| ชั้น | Windows | macOS / Linux |
|---|---|---|
| 1 `compiled` | `csc.exe` → exe มีหน้าต่าง 5 KB | macOS: `clang` + Cocoa → แอปมีหน้าต่าง ~56 KB · Linux: `cc`/`gcc`/`clang` + Xlib ผ่าน `dlopen` → โปรแกรม X11 มีหน้าต่าง ~72 KB |
| 2 `system` | ก๊อป `System32\waitfor.exe` + signal token เฉพาะตัว | Linux: ก๊อป `/bin/sleep 999999` · macOS: **ไม่มีชั้นนี้** |
| 3 `node` | ก๊อป `node.exe` + `keepalive.js` | ก๊อป `node` + `keepalive.js` (`chmod 755`) |
| วิธีหยุด | `taskkill /PID <pid> /T /F` | `SIGTERM` แล้วตามด้วย `SIGKILL` ใน 3 วินาที |

## คำสั่งตรวจสอบ (Linux)

placeholder รันอยู่จริงไหม และรันจาก path ปลอมหรือเปล่า:

```bash
for d in /proc/[0-9]*; do case "$(readlink $d/exe)" in *data/runtime*) echo "${d#/proc/} -> $(readlink $d/exe)";; esac; done
```

มีหน้าต่างไหม (สองคำสั่งนี้มาจากแพ็กเกจ `x11-utils`):

```bash
xwininfo -root -tree | grep -i <ชื่อเกม>       # ต้องเจอขนาด 480x160 พร้อมชื่อเกม
xprop -id <window id> _NET_WM_PID WM_CLASS    # pid ต้องเป็นของ placeholder
```

เก็บของที่ค้างอยู่ (server ที่พังกลางทางอาจทิ้ง placeholder ไว้):

```bash
pkill -f "data/runtime"
```

## คำสั่งตรวจสอบ (macOS)

บน Mac `ps` ใช้อ่าน path ของ placeholder ไม่ได้ (`keepalive.js` ตั้ง `process.title` ซึ่งเขียนทับ
argv ที่ตารางโปรเซสแสดง) และ `pgrep -f` ก็ไปแมตช์ command line ของ shell ตัวเองจนรายงานผิดได้
ให้ถามเคอร์เนลด้วยฟังก์ชันเดียวกับที่ Discord ใช้:

```bash
lsappinfo list | grep -A2 -i <ชื่อเกม>        # macOS มองเห็นเป็นแอปที่รันอยู่จริงไหม
stat -f "links=%l inode=%i" <path>            # links ต้องเป็น 1 ถ้าไม่ใช่ = เป็น hard link ซึ่งใช้ไม่ได้
python3 -c "import ctypes,ctypes.util,sys
libc=ctypes.CDLL(ctypes.util.find_library('c')); b=ctypes.create_string_buffer(4096)
libc.proc_pidpath(ctypes.c_int(int(sys.argv[1])),b,4096); print(b.value.decode())" <pid>
```

คำสั่งสุดท้ายต้องพิมพ์ path ปลอมของเกมออกมา ถ้าพิมพ์ path ของ Node แทน = Discord เห็นโปรเซสชื่อ
`node` และตรวจไม่เจอแน่นอน

อีกครึ่งคือเรื่องหน้าต่าง ซึ่งเป็น API เดียวกับที่ Discord เรียก คอมไพล์ครั้งเดียวด้วย `swiftc`
ที่มาพร้อม Command Line Tools:

```swift
import CoreGraphics; import Foundation
let target = Int(CommandLine.arguments[1])!
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements],
                                      kCGNullWindowID) as? [[String: Any]] ?? []
for w in list where (w[kCGWindowOwnerPID as String] as? Int) == target {
  print("onscreen=\(w[kCGWindowIsOnscreen as String] ?? false) layer=\(w[kCGWindowLayer as String] ?? -1)")
}
```

`onscreen=true layer=0` = หน้าต่างแอปปกติ ถ้าไม่พิมพ์อะไรเลย = โปรเซสนั้นไม่มีหน้าต่าง (ชั้น `node`)
ส่วนชื่อหน้าต่างจะอ่านไม่ได้ถ้าไม่ได้ให้สิทธิ์ Screen Recording — เป็นเรื่องปกติ ไม่ได้แปลว่าไม่มีหน้าต่าง

ถ้า placeholder ตายเอง macOS จะบันทึกเหตุผลไว้ที่ `~/Library/Logs/DiagnosticReports/<ชื่อ>-*.ips`
(อ่านคีย์ `exception` กับ `termination` ใน JSON) เก็บกวาดของค้าง:

```bash
pkill -f "data/runtime"
```

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
