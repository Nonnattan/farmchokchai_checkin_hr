# วิธีต่อ AppSheet

ชุดนี้ออกแบบให้ใช้ Google Sheet เป็น source แล้วเอา AppSheet มาครอบอีกชั้น เพื่อให้หน้า admin อ่าน/จัดการข้อมูลชุดเดียวกันได้

## ขั้นตอน
1. เปิดไฟล์ `data/Area_Setup_Template.xlsx`
2. คัดลอกหรืออัปโหลดไปเป็น Google Sheet
3. ใช้ชีต `location`, `AreaAssignments`, `Users`, และ `Logs`
4. ถ้าจะสร้าง AppSheet ให้เลือก source เป็น Google Sheet นี้ แล้ว map คอลัมน์ให้ตรงตามหัวตาราง
5. ถ้าจะใช้ Apps Script ชุดนี้ ให้ใส่ `SPREADSHEET_ID` ใน `apps-script/Code.gs`

## ถ้าจะใช้ AppSheet Database แทน
ทำได้ แต่หน้า admin ที่อ่านจากชีตตรง ๆ จะต้องปรับ backend เพิ่มอีกนิด เพราะตอนนี้โค้ดชุดนี้อ่าน/เขียนที่ชีตเป็นหลัก


## สำหรับหน้า SetArea / Area assignments

ถ้าจะใช้ชุดใหม่ที่รองรับ many-to-many ให้สร้างชีตเพิ่มดังนี้:
- `location` — เก็บข้อมูลพื้นที่
- `AreaAssignments` — เก็บความสัมพันธ์ area ↔ user
- `Users` — ใช้จาก Firestore เป็นหลัก
- `Logs` — ใช้เหมือนเดิม

ชีต `AreaAssignments` ควรมีคอลัมน์:
- `qr_code`
- `email`
- `uid`
- `role`
- `displayName`
- `active`
- `createdAt`
- `updatedAt`
- `updatedBy`

