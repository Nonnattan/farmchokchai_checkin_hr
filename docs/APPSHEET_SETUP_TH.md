# วิธีต่อ AppSheet

ชุดนี้ออกแบบให้ใช้ Google Sheet เป็น source แล้วเอา AppSheet มาครอบอีกชั้น เพื่อให้หน้า admin อ่าน/จัดการข้อมูลชุดเดียวกันได้

## ขั้นตอน
1. เปิดไฟล์ `data/Logs_Template.xlsx`
2. คัดลอกหรืออัปโหลดไปเป็น Google Sheet
3. เปิด AppSheet แล้วสร้างแอปจาก Google Sheet นั้น
4. เลือกชีตชื่อ `Logs`
5. ตั้งคอลัมน์ให้ตรงนี้
   - `Name` = Text
   - `Lat` = Decimal / LatLong ตามวิธีที่คุณใช้
   - `Lng` = Decimal / LatLong ตามวิธีที่คุณใช้
   - `Time` = DateTime
6. ถ้าจะใช้ Apps Script ชุดนี้ ให้ใส่ `SPREADSHEET_ID` ใน `apps-script/Code.gs`

## ถ้าจะใช้ AppSheet Database แทน
ทำได้ แต่หน้า admin ที่อ่านจากชีตตรง ๆ จะต้องปรับ backend เพิ่มอีกนิด เพราะตอนนี้โค้ดชุดนี้อ่าน/เขียนที่ชีตเป็นหลัก
