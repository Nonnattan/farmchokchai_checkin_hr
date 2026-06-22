# Farm Chokchai Check-in LIFF Flow v2

โฟลเดอร์นี้แยก flow เป็น 3 หน้า:

- `user/checkin.html` = หน้าเช็กอินหลัก
- `processing.html` = หน้า spinner ตอนบันทึกข้อมูล
- `success.html` = หน้าแสดงผลสำเร็จ

## ข้อมูลที่ส่งไป Google Sheets
คอลัมน์:
- `name`
- `email`
- `lat`
- `lng`
- `time`

## จุดที่ต้องตั้งค่า
### assets/common.js
- ใส่ `API_URL` ของ Apps Script Web App `/exec`
- ใส่ `LIFF_ID`

### apps-script/Code.gs
- ใส่ `SPREADSHEET_ID`

## หมายเหตุเรื่อง LINE
- LIFF ใช้ `openid` และ `email` scope เพื่ออ่าน email จาก ID token / decoded ID token
- `profile` ใช้สำหรับ `liff.getProfile()`

## วิธีตั้งค่า LIFF
ให้ชี้ Endpoint URL ไปที่หน้า:
- `.../user/checkin.html`

`success.html` และ `processing.html` เป็นหน้ารองสำหรับ flow หลังจากเช็กอิน

## วิธีทำงาน
1. เปิด `user/checkin.html`
2. ตรวจพิกัดและเก็บชื่อจาก LINE
3. ผู้ใช้กรอก email ถ้าจำเป็น
4. กดเช็กอิน
5. ไปหน้า `processing.html` พร้อม spinner
6. บันทึกลง Google Sheets
7. ไปหน้า `success.html`



## Troubleshooting login / GPS
- LIFF ต้องเปิดจาก URL ที่เป็น endpoint จริง และควรเป็น `https` เท่านั้น
- `navigator.geolocation` ใช้งานได้เฉพาะ secure context (HTTPS)
- ถ้าเปิดจากไฟล์ local หรือ host ที่ไม่ใช่ HTTPS จะมีโอกาส login / ขอพิกัดไม่ทำงาน
- ตอนเปิดจาก external browser จะให้ `liff.init({ withLoginOnExternalBrowser: true })` ช่วย auto login ได้


## ความเข้ากันได้ของ Google Sheets
ระบบอ่านได้ทั้ง 2 แบบ:
- แบบ 6 คอลัมน์: `Name, Email, Phone, Lat, Lng, Time`
- แบบ 12 คอลัมน์: `createdAt, displayName, email, site, session, lat, lng, accuracy, userId, pictureUrl, status`

ถ้าหน้า Logs ขึ้นว่าง ให้ลองแท็บ `ทั้งหมด` ก่อน เพราะเวอร์ชันนี้จะไม่กรองทิ้งเพราะอ่านคอลัมน์ผิดรูปแบบอีกแล้ว


## Logs page update
- หน้า Logs เปิดที่แท็บ `วันนี้` เป็นค่าเริ่มต้น
- โหลดข้อมูลครั้งละ 15 รายการ และจะโหลดเพิ่มอัตโนมัติเมื่อเลื่อนลง
- Export CSV จะออกตามตัวกรองที่เลือก และคงเวลาเดิมตามที่เก็บในชีต

## Setup Apps Script
- Code อยู่ที่ folder apps-script/Code.gs
- นำ Code ทั้งหมดนี้ Copy วางเข้า Apps Script ชื่อ file Code.gs ได้เลย
