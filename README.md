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

