# สรุปการแก้ไข farmchokchai_checkin_hr

## ปัญหาที่ 1 — GPS Test Mode เก็บแค่ 2 ครั้ง (ไม่ใช่ 10 ครั้ง)

### Root Cause

โค้ดเดิมมี **2 ปัญหาซ้อนกัน** ที่ทำให้ดูเหมือนเก็บแค่ 2 ครั้ง:

| # | สาเหตุ | ผลที่เกิด |
|---|--------|-----------|
| 1 | `MAX_GPS_READINGS = 5` (ลดจาก 10 เหลือ 5 ในโค้ดเดิม) | เก็บแค่ 5 ครั้งแทน 10 |
| 2 | `READING_INTERVAL_MS = 2000` (2 วินาที/ครั้ง) แต่ `watchPosition()` บนมือถือบางรุ่นยิง callback เร็วกว่า 2 วินาที ทำให้ครบ 5 ครั้งภายใน ~2 วินาที ดูเหมือนเก็บแค่ 2 ครั้ง | เสร็จเร็วเกินจริง ผู้ใช้เห็นแค่ 1-2 ครั้งในหน้าจอ |
| 3 | ไม่มี checkbox "Test" ใน qr_code.js และไม่มีการส่ง `?test=1` ใน URL | ไม่มีทางเปิด Test Mode ได้เลย |
| 4 | ไม่มี action `testLog` ใน Code.gs และไม่มี Sheet "Test" | ถึงแม้จะส่งข้อมูลไปก็ไม่มีที่รับ |

### ไฟล์ที่แก้ไข

#### 1. `assets/page-scripts/qr_code.js`
- เพิ่ม `testMode = ref(false)` — state ของ checkbox
- เพิ่ม checkbox "Test" ใน template พร้อม `@change="buildQR"` เพื่อสร้าง QR ใหม่ทันทีเมื่อติ๊ก
- แก้ `buildQR()` ให้ append `&test=1` ใน URL เมื่อ `testMode.value === true`
- ผล: เมื่อสแกน QR ที่สร้างจาก Test Mode จะเปิด `checkin.html?...&test=1`

#### 2. `assets/page-scripts/user-checkin.js`
- เพิ่ม constant `TEST_MAX_GPS_READINGS = 10` และ `TEST_READING_INTERVAL_MS = 1000`
- เพิ่ม `const testMode = query.get("test") === "1"` — อ่านจาก URL parameter
- แก้ `startGPSSampling()`:
  - เลือก `MAX_READINGS` และ `READING_INTERVAL` ตาม `testMode` (10/1s หรือ 5/2s)
  - **เพิ่ม block `if (testMode)`** ภายใน loop ทุกครั้งที่อ่านค่าได้: เรียก `common.addTestLog()` ทันที (fire-and-forget ไม่บล็อก GPS sampling)
  - บันทึก `sampleIndex`, `isInsideBoundary`, `areaId` ไปด้วยทุกครั้ง
  - เมื่อครบ 10 ครั้ง: แสดงสถานะสำเร็จ **ไม่ redirect** ไปหน้า processing (ผู้ใช้กด Check-in ใหม่ได้ทันที)
  - โหมดปกติ (ไม่ติ๊ก Test): Logic เดิมทุกอย่าง ไม่เปลี่ยนแปลง
- แก้ `dynamicButtonText` ให้แสดง `[TEST]` / `[TEST MODE]` เมื่ออยู่ใน Test Mode

#### 3. `assets/common.js`
- เพิ่มฟังก์ชัน `addTestLog(entry, timeoutMs)` — POST ไปยัง action `testLog`
- Export ฟังก์ชันใน `window.CheckinCommon`

#### 4. `apps-script/Code.gs`
- เพิ่ม constant `TEST_SHEET_NAME = "Test"` และ `TEST_LOG_HEADERS` (เหมือน Logs + `sampleIndex`, `areaId`, `isInsideBoundary`)
- เพิ่มฟังก์ชัน `ensureTestSheetSchema()` — สร้าง/ตรวจสอบ Sheet "Test"
- เพิ่มฟังก์ชัน `saveTestLog(payload)` — บันทึกลง Sheet "Test" **ไม่ตรวจ Geofence** ไม่ว่าจะอยู่ในหรือนอกพื้นที่
- เพิ่ม `action === "testLog"` ใน `doPost()` — รับ request จาก `addTestLog`

---

## ปัญหาที่ 2 — LINE Login บน Android: โหลด Profile ไม่ได้, ต้องปิด Browser สแกน QR ใหม่, Error "access token revoked"

### Root Cause

| # | สาเหตุ | ผลที่เกิด |
|---|--------|-----------|
| 1 | `liff.getProfile()` ถูกเรียกโดยไม่มี timeout และไม่มี try/catch แยก | ถ้า token revoked, getProfile() throw error แล้ว catch รวมทำให้ authState เป็น "error" ผู้ใช้กดปุ่มไม่ได้ |
| 2 | เมื่อ token revoked ไม่มีการล้าง LIFF session ออก | LIFF SDK ยังคิดว่า logged in อยู่ (isLoggedIn() = true) แต่ token ใช้ไม่ได้ ทำให้วนซ้ำ |
| 3 | ไม่มีการ login ใหม่อัตโนมัติเมื่อ token revoked | ผู้ใช้ต้องปิด browser แล้วสแกน QR ใหม่เอง |
| 4 | `liff.init()` ไม่มีการจัดการ token revoked error แยก | ถ้า init() throw เพราะ token ก็จะ set authState = "error" ทั้งที่ควร login ใหม่ |

### ไฟล์ที่แก้ไข

#### `assets/page-scripts/user-checkin.js`

**เพิ่มฟังก์ชัน `isTokenRevokedError(err)`**
- ตรวจสอบ error message ว่ามีคำว่า "revoked", "token", "unauthorized", "invalid" หรือ HTTP 401/403
- ใช้ร่วมกันทั้ง init และ getProfile

**เพิ่มฟังก์ชัน `clearLiffSession()`**
- ลบ localStorage keys ที่ขึ้นต้นด้วย `LIFF_STORE:`, `liff_`, หรือมี `access_token`
- บังคับล้าง token เก่าออกก่อน login ใหม่

**แก้ `initLiff()` — แยก try/catch ของ `getProfile()` ออกมา**

```
liff.init() → สำเร็จ
  ├─ isLoggedIn() = true
  │   ├─ getProfile() → สำเร็จ → authState = "logged_in" ✓
  │   ├─ getProfile() → token revoked → clearLiffSession() → liff.login() อัตโนมัติ ✓
  │   └─ getProfile() → network error → authState = "logged_in" (ใช้ profile = null) ✓
  └─ isLoggedIn() = false → liff.login() อัตโนมัติ ✓
liff.init() → token revoked → clearLiffSession() → liff.login() อัตโนมัติ ✓
liff.init() → error อื่น → authState = "error" (กดปุ่ม retry ได้) ✓
```

**ผลลัพธ์ที่ได้:**
- ผู้ใช้ที่เคย Login แล้ว Session ยังใช้งานได้ → เข้าใช้งานได้ทันที ไม่ถามสิทธิ์อีก
- Token revoked → ล้าง session → Login ใหม่อัตโนมัติ → ไม่ต้องสแกน QR ใหม่
- Network error ชั่วคราว → ยังเช็คอินได้ (profile = null แต่ userId ยังมาจาก LIFF)
- LIFF init ล้มเหลว → กดปุ่ม "ลองเชื่อมต่อใหม่" ได้ในหน้าเดิม

---

## สรุปไฟล์ที่แก้ไขทั้งหมด

| ไฟล์ | การเปลี่ยนแปลง |
|------|----------------|
| `apps-script/Code.gs` | เพิ่ม `TEST_SHEET_NAME`, `TEST_LOG_HEADERS`, `ensureTestSheetSchema()`, `saveTestLog()`, action `testLog` |
| `assets/common.js` | เพิ่ม `addTestLog()` และ export |
| `assets/page-scripts/user-checkin.js` | เพิ่ม `testMode`, `TEST_MAX_GPS_READINGS=10`, `TEST_READING_INTERVAL_MS=1000`, แก้ `startGPSSampling()`, เพิ่ม `isTokenRevokedError()`, `clearLiffSession()`, แก้ `initLiff()` |
| `assets/page-scripts/qr_code.js` | เพิ่ม `testMode` ref, checkbox "Test", ส่ง `?test=1` ใน QR URL |

## ไฟล์ที่ไม่ได้แก้ไข (ไม่กระทบ Business Logic อื่น)

- `apps-script/Code.gs` — `saveLog()`, `validateGeofence()` ทุกส่วน ไม่เปลี่ยนแปลง
- `assets/page-scripts/processing.js` — ไม่เปลี่ยนแปลง
- `assets/page-scripts/success.js` — ไม่เปลี่ยนแปลง
- `user/checkin.html` — ไม่เปลี่ยนแปลง
- ไฟล์อื่นๆ ทั้งหมด — ไม่เปลี่ยนแปลง
