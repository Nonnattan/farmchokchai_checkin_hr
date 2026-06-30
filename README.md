# Farm Chokchai Check-in — Role & Area Setup

โปรเจกต์นี้แยกเป็น 3 ส่วนหลัก

1. **Firebase Authentication** สำหรับล็อกอิน
2. **Firestore collection `users`** สำหรับเก็บ role และสิทธิ์รายคน
3. **Google Sheet + Apps Script** สำหรับเก็บพื้นที่เช็กอิน, logs, สถานะ geofence และตาราง many-to-many สำหรับการ assign user/area

## หน้าแต่ละส่วน

- `index.html` — หน้าเข้าสู่ระบบ
- `admin.html` — หน้าดูพื้นที่ทั้งหมด / แผนที่ / ปุ่มไปหน้า QR
- `qr_code.html` — สร้าง QR ของแต่ละพื้นที่
- `setarea.html` — หน้า Settings ของพื้นที่แบบมีแผนที่ (ใช้ชื่อ SetArea ให้ชัดเจน)
  - เลือกผู้ใช้ด้วย checkbox จาก Firestore collection `users` เฉพาะ role `admin` และ `masteradmin`
- `users.html` — masteradmin ใช้กำหนด role และ assign สิทธิ์รายคน
- `settings.html` — alias ที่พาไป `setarea.html` เพื่อรองรับลิงก์เก่า
- `user/checkin.html` — หน้า user เช็กอิน
- `logs.html` — ดูประวัติการเช็กอิน

## Role matrix

### masteradmin
- เห็นทุกหน้า
- เข้า `users.html` ได้
- เข้า `setarea.html` ได้
- เห็นพื้นที่ทั้งหมด
- บันทึกและ assign user/area ได้

### admin
- เห็นหน้า `admin.html`, `qr_code.html`, `logs.html`
- เห็นพื้นที่ที่ถูกอนุญาตตาม `visibleRoles` / `visibleUsers`
- **ไม่เข้า `users.html`**
- **ไม่เข้า `setarea.html`**

### user
- เห็นแค่ `user/checkin.html`
- ใช้เช็กอินตาม area ที่ได้รับสิทธิ์

## การ assign สิทธิ์พื้นที่

ในเวอร์ชันนี้แยกเป็น 2 ชั้น

- `assign` / `visibleRoles` — กำหนด role ที่เห็นพื้นที่ เช่น `masteradmin,admin`
- `email` / `visibleUsers` — รายชื่อ email ของผู้ใช้ที่ถูกผูกกับพื้นที่นี้แบบหลายคนต่อ 1 area

ระบบจะสร้าง sheet เพิ่มอีกตัวคือ `AreaAssignments` สำหรับความสัมพันธ์แบบ many-to-many:
- 1 คนดูได้หลายพื้นที่
- 1 พื้นที่มีผู้ใช้ได้หลายคน

หน้า `setarea.html` จะดึงรายชื่อจาก Firestore collection `users` แล้วแสดงเฉพาะ role `admin` และ `masteradmin` ให้เลือกเท่านั้น

## Schema ที่ใช้ใน Google Sheet

### Sheet: `location` (หรือ `Areas` ถ้าย้ายชื่อ)
คอลัมน์หลักตามไฟล์เดิม

- `lat`
- `lng`
- `north`
- `south`
- `east`
- `west`
- `remark`
- `assign`
- `email`
- `qr_code`

> `qr_code` ใช้เป็นตัวระบุพื้นที่ (`areaId`) และ `email` ใช้เก็บรายการรวมของผู้ใช้ที่ถูก assign

### Sheet: `AreaAssignments`
- `qr_code`
- `email`
- `uid`
- `role`
- `displayName`
- `active`
- `createdAt`
- `updatedAt`
- `updatedBy`

### Sheet: `Users`
- `email`
- `uid`
- `displayName`
- `role`
- `active`
- `visibleAreas`
- `note`
- `updatedAt`
- `updatedBy`

### Sheet: `Logs`
- `createdAt`
- `displayName`
- `email`
- `phone`
- `site`
- `session`
- `lat`
- `lng`
- `accuracy`
- `userId`
- `pictureUrl`
- `status`

## ต้องแก้ Apps Script ไหม

ต้องแก้ใน `apps-script/Code.gs` เพื่อให้
- อ่าน/เขียนพื้นที่จากชีต `location`
- sync ความสัมพันธ์ลง `AreaAssignments`
- ดึงรายชื่อ `users`
- บันทึก `logs`

สิ่งที่ควรเช็กคือ:
1. `SPREADSHEET_ID`
2. ชื่อชีต `location`, `AreaAssignments`, `Users`, `Logs`
3. ให้ Web App ของ Apps Script deploy เรียบร้อย

## เรื่องรายชื่อ Firebase Auth

หน้าเว็บฝั่ง client จะดึงรายชื่อจาก Firestore `users` เป็นหลัก  
ถ้ารายชื่อไม่ขึ้น ให้เช็กว่า user นั้นมี document อยู่ใน collection `users` และ role เป็น `admin` หรือ `masteradmin`


## Tab component

หน้า admin / users / logs / qr_code / setarea ใช้ component `app-tabs` ร่วมกันเพื่อให้ tab หน้าตาและพฤติกรรมตรงกันทุกหน้า


## Template workbook

ไฟล์ `data/Area_Setup_Template.xlsx` มีชีตตัวอย่างสำหรับ `location`, `AreaAssignments`, `Users`, และ `Logs` เพื่อใช้เป็นต้นแบบเวลาสร้าง Google Sheet ใหม่


## SetArea
หน้า `setarea.html` ต้องโหลด Firebase Auth/Firestore และ `firebase-auth.js` ด้วย เพื่อให้ `FirebaseRole.currentSession()` ทำงานได้ครบ

ถ้าเห็น error แนว ๆ `You do not have permission to access the requested document` ตอน save:
- ตรวจว่า Apps Script web app deploy เป็น `Execute as me`
- หรือแชร์ Google Sheet ตัวจริงให้ account ที่รันสคริปต์เข้าถึงได้
- ตรวจว่า `SPREADSHEET_ID` ใน `Code.gs` ตรงกับไฟล์ Google Sheet จริง

---

## 🔧 สิ่งที่แก้ไขในรอบนี้ (สำคัญมาก กรุณาอ่านก่อน deploy)

### ปัญหาที่พบ
1. **กด "บันทึก" พื้นที่ใหม่ในหน้า SetArea แล้วเขียนทับพื้นที่เดิม** ไม่เพิ่มแถวใหม่
2. **คอลัมน์ `qr_code` ในชีต `location` ว่างเปล่าทุกแถว** ไม่เคยถูกเขียนค่าจริง
3. **ปุ่ม "ดู QR" ในหน้า Admin** บางครั้งพากดูพื้นที่ผิดจากแถวที่กดจริง (ใช้ค่าจำใน localStorage ทับ URL)

### สาเหตุที่แท้จริง
- ฟังก์ชันแปลงข้อมูล (`normalizeArea`) ทั้งในหน้า SetArea และไฟล์ `common.js` เมื่อพบแถวที่ยังไม่มีรหัส `qr_code` (เช่นข้อมูลเก่าที่กรอกตรงใน Google Sheet โดยไม่ผ่านระบบ) จะใส่ค่า fallback เป็นคำว่า `"qr_code"` **เหมือนกันทุกแถว** ทำให้ระบบมองว่าทุกพื้นที่คือพื้นที่เดียวกัน เวลาบันทึกจึงเขียนทับกันไปเรื่อยๆ
- ฝั่ง Apps Script (`Code.gs`) ฟังก์ชัน `saveLocation` ไม่ได้ป้องกันกรณีนี้ไว้ตั้งแต่ต้น
- หน้า `qr_code.html` มี logic จำค่าพื้นที่ล่าสุดไว้ใน `localStorage` ที่บางเงื่อนไขไปแทรกทับค่าจาก URL

### สิ่งที่แก้ไขแล้ว
1. **`apps-script/Code.gs`**
   - เพิ่มฟังก์ชัน `generateUniqueQrCode()` สร้างรหัสพื้นที่ที่ไม่ซ้ำกันโดยอัตโนมัติ (รูปแบบ `AREA-YYYYMMDDHHMMSS-XXXX`)
   - แก้ `saveLocation()` ให้แยกแยะชัดเจนระหว่าง "สร้างใหม่" (ไม่มี `originalAreaId` ส่งมา) กับ "แก้ไขของเดิม" — ตอนสร้างใหม่จะ**ไม่มีทางไปจับคู่ทับแถวเดิมได้เด็ดขาด** แม้รหัสจะว่างหรือซ้ำกันก็ตาม ระบบจะสร้างรหัสใหม่ให้ทันที
   - แก้ `updateAreaAssignments()` และ `deleteLocation()` ให้ใช้คอลัมน์ `qr_code` สอดคล้องกันทั้งหมด (เดิมบางจุดใช้ `areaId` ซึ่งไม่มีอยู่ในชีตจริง)
2. **`assets/common.js`** และ **`assets/page-scripts/setarea.js`**
   - แก้ `normalizeArea()` ไม่ให้ fallback เป็นรหัสคงที่ซ้ำกันทุกแถวอีกต่อไป
   - แก้ `save()` ในหน้า SetArea ให้ตรวจสอบและสร้างรหัสใหม่ที่ไม่ชนกับพื้นที่ที่มีอยู่แล้วทุกครั้งที่กด "+ เพิ่มพื้นที่" แล้วบันทึก
3. **`assets/page-scripts/qr_code.js`**
   - เขียนใหม่ทั้งหมด: `areaId` จาก URL (เช่นจากปุ่ม "ดู QR") จะมีสิทธิ์สูงสุดเสมอ ไม่ถูก localStorage ทับอีกต่อไป
   - เพิ่มข้อความแจ้งเตือนถ้า `areaId` ใน URL หาไม่พบในรายการที่มีสิทธิ์เห็น
4. **`admin.html` / `assets/page-scripts/admin.js`** และ **`setarea.html`**
   - ปุ่ม "ดู QR" ต่อแถว เมื่อกดแต่ละแถวจะพาไปหน้า QR ของพื้นที่นั้นๆ ทันที (เปิดแท็บใหม่)
   - เพิ่มปุ่ม "ดู QR" ในหน้า SetArea ด้วย ทั้งในตารางและในกล่อง "พื้นที่ที่เลือก" เพื่อความสะดวก ไม่ต้องสลับไปหน้า Admin
   - ฟิลด์ `qr_code / areaId` ในฟอร์มแก้ไข จะถูกล็อก (disabled) เมื่อกำลังแก้ไขพื้นที่ที่มีอยู่แล้ว เพื่อป้องกันไม่ให้พิมพ์ทับรหัสโดยไม่ตั้งใจ — แก้ไขได้เฉพาะตอนสร้างพื้นที่ใหม่ (และเว้นว่างได้ ระบบจะสร้างให้อัตโนมัติ)

### ⚠️ ขั้นตอนที่ต้องทำก่อนใช้งานจริง (สำคัญ)
1. **ต้อง deploy `apps-script/Code.gs` เวอร์ชันใหม่นี้ทับของเดิม** ที่ Google Apps Script Editor ของโปรเจกต์ (เปิดไฟล์ในนี้ → copy ทั้งหมด → วางทับใน Apps Script Editor → กด Deploy → New deployment หรือ Manage deployments → แก้ deployment เดิม) ถ้าไม่ deploy ใหม่ บั๊กจะยังเป็นเหมือนเดิมเพราะ frontend เรียก API ตัวเดิมอยู่
2. **ข้อมูลเดิมในชีต `location` ที่คอลัมน์ `qr_code` ว่างอยู่ก่อนหน้านี้** จะถูกระบบมองเป็น "ข้อมูลเก่าที่ยังไม่มีรหัส" — แนะนำให้เปิดหน้า SetArea แล้วกดเลือกพื้นที่นั้น กดบันทึกอีกครั้งหนึ่งครั้ง (ระบบจะสร้างรหัส `qr_code` ให้อัตโนมัติและเขียนกลับเข้าชีต) ก่อนเริ่มสร้างพื้นที่ใหม่เพิ่ม เพื่อให้ปุ่ม "ดู QR" ของแถวนั้นใช้งานได้
3. ทดสอบโดย: เข้าหน้า SetArea → กด "+ เพิ่มพื้นที่" → กรอกข้อมูล → กดบันทึก → ทำซ้ำอีก 2-3 ครั้ง → ตรวจในตารางว่ามีหลายแถวเพิ่มขึ้นจริง (ไม่ทับกัน) → ลองกดปุ่ม "ดู QR" ของแต่ละแถวว่าได้ QR คนละอันจริง


