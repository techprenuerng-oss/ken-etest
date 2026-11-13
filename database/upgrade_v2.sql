-- KEN E-TEST production-safe upgrade. Run ONCE against the existing ken_etest database.
-- This script adds columns/tables only; it does NOT drop or reset existing data.
USE `ken_etest`;

ALTER TABLE students ADD COLUMN matric_number VARCHAR(40) NULL AFTER student_id;
UPDATE students SET matric_number = student_id WHERE matric_number IS NULL OR matric_number = '';
ALTER TABLE students MODIFY matric_number VARCHAR(40) NOT NULL;
ALTER TABLE students ADD UNIQUE KEY uq_students_matric_number (matric_number);

ALTER TABLE exams ADD COLUMN scheduled_start DATETIME NULL AFTER status;
ALTER TABLE exams ADD COLUMN scheduled_end DATETIME NULL AFTER scheduled_start;

CREATE TABLE support_tickets (
  ticket_id VARCHAR(12) NOT NULL,
  student_id VARCHAR(10) NOT NULL,
  exam_id VARCHAR(10) NULL,
  category VARCHAR(60) NOT NULL,
  subject VARCHAR(120) NOT NULL,
  message TEXT NOT NULL,
  status ENUM('Open','In Progress','Resolved') NOT NULL DEFAULT 'Open',
  admin_reply TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (ticket_id),
  KEY idx_support_student (student_id),
  KEY idx_support_status (status),
  CONSTRAINT fk_support_student FOREIGN KEY (student_id) REFERENCES students(student_id),
  CONSTRAINT fk_support_exam FOREIGN KEY (exam_id) REFERENCES exams(exam_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Three presentation accounts. Their shared demo password is Student@123.
-- Replace these records on a real institutional deployment if desired.
INSERT INTO students (student_id, matric_number, full_name, email, password_hash, `class`, status, date_registered)
SELECT 'STU006','DEMO/2026/001','Demo Student One','demo.student1@ken-etest.local',
       '$2y$10$NpgA.tGFbGraj4Or9dJIWelm6WKTjgNMBnvBopy7R9KIu2ekbAt56','Computer Science 400L','Active',UTC_TIMESTAMP()
WHERE NOT EXISTS (SELECT 1 FROM students WHERE student_id='STU006' OR matric_number='DEMO/2026/001');
INSERT INTO students (student_id, matric_number, full_name, email, password_hash, `class`, status, date_registered)
SELECT 'STU007','DEMO/2026/002','Demo Student Two','demo.student2@ken-etest.local',
       '$2y$10$4QMfrOpLx4ugfvdzl.rOMORlZ7.9T.IlUDXc.r8SJEw3p1NBUdwRu','Information Technology 300L','Active',UTC_TIMESTAMP()
WHERE NOT EXISTS (SELECT 1 FROM students WHERE student_id='STU007' OR matric_number='DEMO/2026/002');
INSERT INTO students (student_id, matric_number, full_name, email, password_hash, `class`, status, date_registered)
SELECT 'STU008','DEMO/2026/003','Demo Student Three','demo.student3@ken-etest.local',
       '$2y$10$/XgrKF7UDgUmWZfrc8hte.32trZZJ071eLKbrvYOeFS13Xm4/gzuC','Computer Science 400L','Active',UTC_TIMESTAMP()
WHERE NOT EXISTS (SELECT 1 FROM students WHERE student_id='STU008' OR matric_number='DEMO/2026/003');

INSERT INTO counters (name, value) VALUES ('support', 0), ('student', 8)
ON DUPLICATE KEY UPDATE value = GREATEST(value, VALUES(value));
