# Farm Chokchai Check-in — Role & Area Setup

โปรเจกต์นี้แยกเป็น 3 ส่วนหลัก

1. **Firebase Authentication** สำหรับล็อกอิน
2. **Firestore collection `users`** สำหรับเก็บ role และสิทธิ์รายคน
3. **Google Sheet + Apps Script** สำหรับเก็บพื้นที่เช็กอิน, logs และสถานะ geofence

## หน้าแต่ละส่วน

- `index.html` — หน้าเข้าสู่ระบบ
- `admin.html` — หน้าดูพื้นที่ทั้งหมด / แผนที่ / ปุ่มไปหน้า QR
- `qr_code.html` — สร้าง QR ของแต่ละพื้นที่
- `setarea.html` — หน้า Settings ของพื้นที่แบบมีแผนที่ (ใช้ชื่อ SetArea ให้ชัดเจน)
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

ในชีต `Areas` ให้ใช้คอลัมน์เหล่านี้:

- `visibleRoles` — ระบุ role ที่เห็นพื้นที่นี้ เช่น `masteradmin,admin`
- `visibleUsers` — ระบุ uid หรือ email ที่มองเห็นพื้นที่นี้ เช่น `uid1,uid2` หรือ `name@example.com`

ระบบจะตรวจจาก 2 ช่องนี้ร่วมกัน:
- ถ้า role ตรงกับ `visibleRoles` จะเห็นพื้นที่
- ถ้า uid/email ตรงกับ `visibleUsers` จะเห็นพื้นที่

## Schema ที่แนะนำใน Google Sheet

### Sheet: `Areas`
- `areaId`
- `areaName`
- `lat`
- `lng`
- `north`
- `south`
- `east`
- `west`
- `note`
- `active`
- `visibleRoles`
- `visibleUsers`
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

โค้ดชุดนี้ใช้ Apps Script อยู่แล้ว และมี endpoint สำหรับ
- `areas`
- `users`
- `logs`

ดังนั้นโดยปกติ **ไม่ต้องเพิ่ม endpoint ใหม่** ถ้าต้องการแค่:
- บันทึกพื้นที่
- บันทึก role / assign user
- อ่าน logs

สิ่งที่ควรเช็กคือ:
1. `SPREADSHEET_ID`
2. ชื่อชีต `Areas`, `Users`, `Logs`
3. ให้ Web App ของ Apps Script deploy เรียบร้อย

## สำคัญเรื่องรายชื่อ Firebase Auth ทั้งหมด

หน้าเว็บฝั่ง client **ไม่สามารถดึงรายชื่อ Firebase Authentication users ทั้งหมดได้ตรง ๆ**  
ถ้าต้องการโชว์รายชื่อ Auth ทั้งระบบจริง ๆ ต้องมี backend เพิ่ม เช่น
- Cloud Functions
- Cloud Run
- หรือ Apps Script ที่ผูก Service Account / Admin SDK

แต่ถ้าใช้ตามโครงนี้ แนะนำให้จัดการรายชื่อผู้ใช้ใน Firestore `users` เป็นหลัก


## Tab component

หน้า admin / users / logs / qr_code / setarea ใช้ component `app-tabs` ร่วมกันเพื่อให้ tab หน้าตาและพฤติกรรมตรงกันทุกหน้า
