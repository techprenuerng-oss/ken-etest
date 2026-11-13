-- ============================================================================
-- Ken E-Test  -  MySQL / MariaDB database
-- Online Quiz and Examination System, Python (Flask) + MySQL edition.
--
-- HOW TO USE: import this one file (phpMyAdmin > Import, or the mysql command line).
-- It creates the database `ken_etest`, all tables, and the demo data.
--
-- WARNING: this file DROPS and re-creates every table. Importing it again wipes all
-- data and restores the demo data. That is the "reset" button for a demonstration.
--
-- Demo logins are listed in README.md (admin / Admin@123, students use Student@123).
-- Passwords are stored as bcrypt hashes (bcrypt), never as plain text.
-- ============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE DATABASE IF NOT EXISTS `ken_etest` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `ken_etest`;

DROP TABLE IF EXISTS `support_tickets`;
DROP TABLE IF EXISTS `sessions`;
DROP TABLE IF EXISTS `exam_attempts`;
DROP TABLE IF EXISTS `proctoring_logs`;
DROP TABLE IF EXISTS `results`;
DROP TABLE IF EXISTS `questions`;
DROP TABLE IF EXISTS `exams`;
DROP TABLE IF EXISTS `students`;
DROP TABLE IF EXISTS `admins`;
DROP TABLE IF EXISTS `counters`;

-- ---------------------------------------------------------------- tables ----

CREATE TABLE `admins` (
  `admin_id`      VARCHAR(10)  NOT NULL,
  `username`      VARCHAR(60)  NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `name`          VARCHAR(80)  NOT NULL,
  PRIMARY KEY (`admin_id`),
  UNIQUE KEY `uq_admins_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `students` (
  `student_id`      VARCHAR(10)  NOT NULL,
  `matric_number`   VARCHAR(40)  NOT NULL,
  `full_name`       VARCHAR(80)  NOT NULL,
  `email`           VARCHAR(120) NOT NULL,
  `password_hash`   VARCHAR(255) NOT NULL,
  `class`           VARCHAR(60)  NOT NULL,
  `status`          ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
  `date_registered` DATETIME     NOT NULL,
  PRIMARY KEY (`student_id`),
  UNIQUE KEY `uq_students_email` (`email`),
  UNIQUE KEY `uq_students_matric_number` (`matric_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The number of questions is NOT stored here; it is counted from `questions`,
-- so it can never get out of date (the Google Sheets version had to keep a copy in sync).
CREATE TABLE `exams` (
  `exam_id`          VARCHAR(10)  NOT NULL,
  `title`            VARCHAR(120) NOT NULL,
  `subject`          VARCHAR(80)  NOT NULL,
  `description`      VARCHAR(300) NOT NULL DEFAULT '',
  `duration_minutes` SMALLINT UNSIGNED NOT NULL,
  `pass_mark`        DECIMAL(5,2) NOT NULL,
  `status`           ENUM('Active','Inactive') NOT NULL DEFAULT 'Inactive',
  `scheduled_start`  DATETIME NULL,
  `scheduled_end`    DATETIME NULL,
  `date_created`     DATETIME     NOT NULL,
  PRIMARY KEY (`exam_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `questions` (
  `question_id`    VARCHAR(10)  NOT NULL,
  `exam_id`        VARCHAR(10)  NOT NULL,
  `question`       VARCHAR(500) NOT NULL,
  `option_a`       VARCHAR(200) NOT NULL,
  `option_b`       VARCHAR(200) NOT NULL,
  `option_c`       VARCHAR(200) NOT NULL,
  `option_d`       VARCHAR(200) NOT NULL,
  `correct_answer` ENUM('A','B','C','D') NOT NULL,
  `marks`          SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (`question_id`),
  KEY `idx_questions_exam` (`exam_id`),
  CONSTRAINT `fk_questions_exam` FOREIGN KEY (`exam_id`) REFERENCES `exams` (`exam_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per student per examination. UNIQUE(student_id, exam_id) means the database
-- itself refuses a second attempt, even if two submit requests arrive at the same moment.
CREATE TABLE `results` (
  `result_id`   VARCHAR(10)  NOT NULL,
  `student_id`  VARCHAR(10)  NOT NULL,
  `exam_id`     VARCHAR(10)  NOT NULL,
  `score`       INT UNSIGNED NOT NULL,
  `total_marks` INT UNSIGNED NOT NULL,
  `percentage`  DECIMAL(5,2) NOT NULL,
  `status`      ENUM('PASS','FAIL') NOT NULL,
  `start_time`  DATETIME     NOT NULL,
  `submit_time` DATETIME     NOT NULL,
  PRIMARY KEY (`result_id`),
  UNIQUE KEY `uq_results_student_exam` (`student_id`, `exam_id`),
  KEY `idx_results_exam` (`exam_id`),
  CONSTRAINT `fk_results_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`student_id`),
  CONSTRAINT `fk_results_exam`    FOREIGN KEY (`exam_id`)    REFERENCES `exams` (`exam_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `proctoring_logs` (
  `log_id`            VARCHAR(10)  NOT NULL,
  `student_id`        VARCHAR(10)  NOT NULL,
  `exam_id`           VARCHAR(10)  NOT NULL,
  `event_type`        VARCHAR(30)  NOT NULL,
  `event_description` VARCHAR(200) NOT NULL DEFAULT '',
  `logged_at`         DATETIME     NOT NULL,
  `severity`          ENUM('low','medium','high') NOT NULL,
  PRIMARY KEY (`log_id`),
  KEY `idx_logs_exam` (`exam_id`),
  KEY `idx_logs_student` (`student_id`),
  KEY `idx_logs_time` (`logged_at`),
  CONSTRAINT `fk_logs_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`student_id`),
  CONSTRAINT `fk_logs_exam`    FOREIGN KEY (`exam_id`)    REFERENCES `exams` (`exam_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- An examination that is IN PROGRESS. It remembers when the student started (so a page
-- refresh cannot reset the timer) and the random question/option order given to that
-- student (so the order stays the same if the student refreshes, and so answers can be
-- marked correctly). The row is deleted when the examination is submitted.
CREATE TABLE `exam_attempts` (
  `attempt_id`     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `student_id`     VARCHAR(10)  NOT NULL,
  `exam_id`        VARCHAR(10)  NOT NULL,
  `started_at`     DATETIME     NOT NULL,
  `question_order` TEXT         NOT NULL,
  `option_order`   TEXT         NOT NULL,
  PRIMARY KEY (`attempt_id`),
  UNIQUE KEY `uq_attempt_student_exam` (`student_id`, `exam_id`),
  CONSTRAINT `fk_attempt_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`student_id`),
  CONSTRAINT `fk_attempt_exam`    FOREIGN KEY (`exam_id`)    REFERENCES `exams` (`exam_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Login sessions. Only a SHA-256 hash of the token is stored.
CREATE TABLE `sessions` (
  `token_hash` CHAR(64)    NOT NULL,
  `role`       ENUM('student','admin') NOT NULL,
  `user_id`    VARCHAR(10) NOT NULL,
  `expires_at` DATETIME    NOT NULL,
  PRIMARY KEY (`token_hash`),
  KEY `idx_sessions_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `support_tickets` (
  `ticket_id` VARCHAR(12) NOT NULL,
  `student_id` VARCHAR(10) NOT NULL,
  `exam_id` VARCHAR(10) NULL,
  `category` VARCHAR(60) NOT NULL,
  `subject` VARCHAR(120) NOT NULL,
  `message` TEXT NOT NULL,
  `status` ENUM('Open','In Progress','Resolved') NOT NULL DEFAULT 'Open',
  `admin_reply` TEXT NOT NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  PRIMARY KEY (`ticket_id`),
  KEY `idx_support_student` (`student_id`),
  KEY `idx_support_status` (`status`),
  CONSTRAINT `fk_support_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`student_id`),
  CONSTRAINT `fk_support_exam` FOREIGN KEY (`exam_id`) REFERENCES `exams` (`exam_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Counters used to create readable IDs such as STU006, EX004, Q026, RES010, LOG0009.
-- An update on one row is atomic, so two requests can never receive the same ID.
CREATE TABLE `counters` (
  `name`  VARCHAR(30)  NOT NULL,
  `value` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- ------------------------------------------------------------- demo data ----
-- Dates are relative to the moment of import, so the demo always looks recent.

-- Admin (demo account: admin / Admin@123)
INSERT INTO `admins` (`admin_id`,`username`,`password_hash`,`name`) VALUES
  ('ADM001', 'admin', '$2y$10$0z9tIeY25m0jfFKBCUbo9uTPgouHQUZWOkxx51y.iet8kwjRJywgu', 'System Administrator');

-- Students (demo password for all five: Student@123)
INSERT INTO `students` (`student_id`,`matric_number`,`full_name`,`email`,`password_hash`,`class`,`status`,`date_registered`) VALUES
  ('STU001','STU001', 'Chidinma Okafor', 'chidinma.okafor@demo.edu', '$2y$10$NpgA.tGFbGraj4Or9dJIWelm6WKTjgNMBnvBopy7R9KIu2ekbAt56', 'Computer Science 400L', 'Active', TIMESTAMP(DATE_SUB(UTC_DATE(), INTERVAL 60 DAY), '09:00:00')),
  ('STU002','STU002', 'Tamuno Briggs', 'tamuno.briggs@demo.edu', '$2y$10$4QMfrOpLx4ugfvdzl.rOMORlZ7.9T.IlUDXc.r8SJEw3p1NBUdwRu', 'Computer Science 400L', 'Active', TIMESTAMP(DATE_SUB(UTC_DATE(), INTERVAL 55 DAY), '09:00:00')),
  ('STU003','STU003', 'Ebiere Seigha', 'ebiere.seigha@demo.edu', '$2y$10$/XgrKF7UDgUmWZfrc8hte.32trZZJ071eLKbrvYOeFS13Xm4/gzuC', 'Information Technology 300L', 'Active', TIMESTAMP(DATE_SUB(UTC_DATE(), INTERVAL 48 DAY), '09:00:00')),
  ('STU004','STU004', 'Oluwaseun Adeyemi', 'oluwaseun.adeyemi@demo.edu', '$2y$10$tqyBjbeOScaDyRshU5ftjO3k1KjVTs6uz0aoa2G/.Eptoy/xiRM.6', 'Information Technology 300L', 'Active', TIMESTAMP(DATE_SUB(UTC_DATE(), INTERVAL 40 DAY), '09:00:00')),
  ('STU005','STU005', 'Fatima Bello', 'fatima.bello@demo.edu', '$2y$10$0QtAVXdvyj0ySN5FHT3YkuRlGIsRsM6g0pzEHwXZlXoj0Bnp9NvAS', 'Computer Science 400L', 'Active', TIMESTAMP(DATE_SUB(UTC_DATE(), INTERVAL 35 DAY), '09:00:00'));

-- Additional presentation accounts (password for all three: Student@123).
INSERT INTO `students` (`student_id`,`matric_number`,`full_name`,`email`,`password_hash`,`class`,`status`,`date_registered`) VALUES
  ('STU006','DEMO/2026/001','Demo Student One','demo.student1@ken-etest.local','$2y$10$NpgA.tGFbGraj4Or9dJIWelm6WKTjgNMBnvBopy7R9KIu2ekbAt56','Computer Science 400L','Active',UTC_TIMESTAMP()),
  ('STU007','DEMO/2026/002','Demo Student Two','demo.student2@ken-etest.local','$2y$10$4QMfrOpLx4ugfvdzl.rOMORlZ7.9T.IlUDXc.r8SJEw3p1NBUdwRu','Information Technology 300L','Active',UTC_TIMESTAMP()),
  ('STU008','DEMO/2026/003','Demo Student Three','demo.student3@ken-etest.local','$2y$10$/XgrKF7UDgUmWZfrc8hte.32trZZJ071eLKbrvYOeFS13Xm4/gzuC','Computer Science 400L','Active',UTC_TIMESTAMP());

-- Examinations (EX003 is inactive so you can demonstrate activating it)
INSERT INTO `exams` (`exam_id`,`title`,`subject`,`description`,`duration_minutes`,`pass_mark`,`status`,`date_created`) VALUES
  ('EX001', 'ICT Fundamentals', 'Information and Communication Technology', 'Basic computer hardware, software and Internet concepts.', 15, 50, 'Active', TIMESTAMP(DATE_SUB(UTC_DATE(), INTERVAL 50 DAY), '10:00:00')),
  ('EX002', 'Computer Applications', 'Office Productivity Software', 'Word processing, spreadsheets and presentation software.', 20, 50, 'Active', TIMESTAMP(DATE_SUB(UTC_DATE(), INTERVAL 45 DAY), '10:00:00')),
  ('EX003', 'Introduction to Programming', 'Programming Basics', 'Demo examination that is inactive. Activate it from the admin panel.', 10, 50, 'Inactive', TIMESTAMP(DATE_SUB(UTC_DATE(), INTERVAL 10 DAY), '10:00:00'));

-- Questions (25 multiple-choice questions, 2 marks each)
INSERT INTO `questions` (`question_id`,`exam_id`,`question`,`option_a`,`option_b`,`option_c`,`option_d`,`correct_answer`,`marks`) VALUES
  ('Q001', 'EX001', 'Which of the following is an input device?', 'Monitor', 'Keyboard', 'Printer', 'Speaker', 'B', 2),
  ('Q002', 'EX001', 'What does CPU stand for?', 'Central Processing Unit', 'Computer Personal Unit', 'Central Program Utility', 'Core Processing Unit', 'A', 2),
  ('Q003', 'EX001', 'Which device connects a network to the Internet and directs data between them?', 'Scanner', 'Projector', 'Router', 'Plotter', 'C', 2),
  ('Q004', 'EX001', 'Which type of memory loses its content when the computer is switched off?', 'ROM', 'Hard disk', 'Flash drive', 'RAM', 'D', 2),
  ('Q005', 'EX001', 'How many bits are there in one byte?', '4', '8', '16', '32', 'B', 2),
  ('Q006', 'EX001', 'Which of the following is system software?', 'Microsoft Word', 'Google Sheets', 'Windows operating system', 'Adobe Photoshop', 'C', 2),
  ('Q007', 'EX001', 'What does URL stand for?', 'Uniform Resource Locator', 'Universal Reference Link', 'United Resource Language', 'Uniform Reference Locator', 'A', 2),
  ('Q008', 'EX001', 'Which of the following is a web browser?', 'Linux', 'Excel', 'Python', 'Google Chrome', 'D', 2),
  ('Q009', 'EX001', 'Which of the following is an output device?', 'Mouse', 'Microphone', 'Monitor', 'Scanner', 'C', 2),
  ('Q010', 'EX001', 'What is the main purpose of antivirus software?', 'To speed up the Internet connection', 'To increase screen brightness', 'To store files online', 'To detect and remove malicious software', 'D', 2),
  ('Q011', 'EX002', 'In Microsoft Excel, which function adds the values in a range of cells?', 'COUNT()', 'AVERAGE()', 'SUM()', 'MAX()', 'C', 2),
  ('Q012', 'EX002', 'What is the default file extension of a modern Microsoft Word document?', '.xlsx', '.docx', '.pptx', '.txt', 'B', 2),
  ('Q013', 'EX002', 'Which keyboard shortcut is normally used to save a document?', 'Ctrl + S', 'Ctrl + P', 'Ctrl + Z', 'Ctrl + N', 'A', 2),
  ('Q014', 'EX002', 'In PowerPoint, what is a single page of a presentation called?', 'Sheet', 'Slide', 'Frame', 'Tab', 'B', 2),
  ('Q015', 'EX002', 'Which Excel cell reference points to column B, row 3?', 'B3', '3B', 'B-3', 'R3C2', 'A', 2),
  ('Q016', 'EX002', 'Which application is mainly used to create spreadsheets?', 'Microsoft Word', 'Microsoft PowerPoint', 'Microsoft Paint', 'Microsoft Excel', 'D', 2),
  ('Q017', 'EX002', 'Which word processor feature helps find spelling mistakes?', 'Thesaurus', 'Spell Check', 'Mail Merge', 'Header and Footer', 'B', 2),
  ('Q018', 'EX002', 'What does the shortcut Ctrl + Z do in most applications?', 'Redo the last action', 'Close the window', 'Undo the last action', 'Zoom in', 'C', 2),
  ('Q019', 'EX002', 'Which of the following is a database management application?', 'Microsoft Access', 'Microsoft Outlook', 'Notepad', 'Windows Media Player', 'A', 2),
  ('Q020', 'EX002', 'What is a table used for in a word processor?', 'To play audio', 'To scan for viruses', 'To change the font colour', 'To organise data in rows and columns', 'D', 2),
  ('Q021', 'EX003', 'Which symbol starts a single-line comment in JavaScript?', '#', '//', '--', '<!--', 'B', 2),
  ('Q022', 'EX003', 'Which of the following is a programming language?', 'Python', 'Photoshop', 'Chrome', 'Excel', 'A', 2),
  ('Q023', 'EX003', 'What is a variable?', 'A type of keyboard', 'A kind of loop', 'A named place that stores a value', 'A web browser', 'C', 2),
  ('Q024', 'EX003', 'Which statement repeats code while a condition is true?', 'if', 'switch', 'while', 'return', 'C', 2),
  ('Q025', 'EX003', 'What does HTML stand for?', 'Hyper Trainer Marking Language', 'High Text Machine Language', 'Hyper Transfer Markup Logic', 'HyperText Markup Language', 'D', 2);

-- Results (a mix of pass and fail so the dashboard shows real statistics)
INSERT INTO `results` (`result_id`,`student_id`,`exam_id`,`score`,`total_marks`,`percentage`,`status`,`start_time`,`submit_time`) VALUES
  ('RES001', 'STU001', 'EX001', 16, 20, 80.00, 'PASS', TIMESTAMP(DATE_SUB(UTC_DATE(), INTERVAL 30 DAY), '10:05:00'), DATE_ADD(TIMESTAMP(DATE_SUB(UTC_DATE(), INTERVAL 30 DAY), '10:05:00'), INTERVAL 11 MINUTE)),
  ('RES002', 'STU002', 'EX001', 12, 20, 60.00, 'PASS', TIMESTAMP(DATE_SUB(UTC_DATE(), INTERVAL 29 DAY), '11:20:00'), DATE_ADD(TIMESTAMP(DATE_SUB(UTC_DATE(), INTERVAL 29 DAY), '11:20:00'), INTERVAL 13 MINUTE)),
  ('RES003', 'STU003', 'EX001', 8, 20, 40.00, 'FAIL', TIMESTAMP(DATE_SUB(UTC_DATE(), INTERVAL 28 DAY), '09:40:00'), DATE_ADD(TIMESTAMP(DATE_SUB(UTC_DATE(), INTERVAL 28 DAY), '09:40:00'), INTERVAL 14 MINUTE)),
  ('RES004', 'STU004', 'EX001', 18, 20, 90.00, 'PASS', TIMESTAMP(DATE_SUB(UTC_DATE(), INTERVAL 28 DAY), '14:10:00'), DATE_ADD(TIMESTAMP(DATE_SUB(UTC_DATE(), INTERVAL 28 DAY), '14:10:00'), INTERVAL 9 MINUTE)),
  ('RES005', 'STU005', 'EX001', 10, 20, 50.00, 'PASS', TIMESTAMP(DATE_SUB(UTC_DATE(), INTERVAL 27 DAY), '15:30:00'), DATE_ADD(TIMESTAMP(DATE_SUB(UTC_DATE(), INTERVAL 27 DAY), '15:30:00'), INTERVAL 12 MINUTE)),
  ('RES006', 'STU001', 'EX002', 14, 20, 70.00, 'PASS', TIMESTAMP(DATE_SUB(UTC_DATE(), INTERVAL 20 DAY), '10:15:00'), DATE_ADD(TIMESTAMP(DATE_SUB(UTC_DATE(), INTERVAL 20 DAY), '10:15:00'), INTERVAL 16 MINUTE)),
  ('RES007', 'STU002', 'EX002', 18, 20, 90.00, 'PASS', TIMESTAMP(DATE_SUB(UTC_DATE(), INTERVAL 19 DAY), '13:00:00'), DATE_ADD(TIMESTAMP(DATE_SUB(UTC_DATE(), INTERVAL 19 DAY), '13:00:00'), INTERVAL 15 MINUTE)),
  ('RES008', 'STU003', 'EX002', 10, 20, 50.00, 'PASS', TIMESTAMP(DATE_SUB(UTC_DATE(), INTERVAL 18 DAY), '09:30:00'), DATE_ADD(TIMESTAMP(DATE_SUB(UTC_DATE(), INTERVAL 18 DAY), '09:30:00'), INTERVAL 19 MINUTE)),
  ('RES009', 'STU004', 'EX002', 6, 20, 30.00, 'FAIL', TIMESTAMP(DATE_SUB(UTC_DATE(), INTERVAL 18 DAY), '16:45:00'), DATE_ADD(TIMESTAMP(DATE_SUB(UTC_DATE(), INTERVAL 18 DAY), '16:45:00'), INTERVAL 17 MINUTE));

-- Monitoring (proctoring) log: sample events
INSERT INTO `proctoring_logs` (`log_id`,`student_id`,`exam_id`,`event_type`,`event_description`,`logged_at`,`severity`) VALUES
  ('LOG0001', 'STU003', 'EX001', 'TAB_SWITCH', 'The student switched to another browser tab.', TIMESTAMP(DATE_SUB(UTC_DATE(), INTERVAL 28 DAY), '09:47:00'), 'high'),
  ('LOG0002', 'STU003', 'EX001', 'WINDOW_BLUR', 'The examination window lost focus.', TIMESTAMP(DATE_SUB(UTC_DATE(), INTERVAL 28 DAY), '09:52:00'), 'medium'),
  ('LOG0003', 'STU002', 'EX001', 'FULLSCREEN_EXIT', 'The student exited fullscreen mode.', TIMESTAMP(DATE_SUB(UTC_DATE(), INTERVAL 29 DAY), '11:28:00'), 'high'),
  ('LOG0004', 'STU005', 'EX001', 'RIGHT_CLICK', 'Right-click was attempted during the examination.', TIMESTAMP(DATE_SUB(UTC_DATE(), INTERVAL 27 DAY), '15:38:00'), 'low'),
  ('LOG0005', 'STU004', 'EX002', 'COPY_ATTEMPT', 'The student tried to copy examination content.', TIMESTAMP(DATE_SUB(UTC_DATE(), INTERVAL 18 DAY), '16:52:00'), 'medium'),
  ('LOG0006', 'STU004', 'EX002', 'KEYBOARD_RESTRICTION', 'Restricted keyboard shortcut used: Ctrl+U.', TIMESTAMP(DATE_SUB(UTC_DATE(), INTERVAL 18 DAY), '16:58:00'), 'low'),
  ('LOG0007', 'STU003', 'EX002', 'PASTE_ATTEMPT', 'The student tried to paste into the examination.', TIMESTAMP(DATE_SUB(UTC_DATE(), INTERVAL 18 DAY), '09:41:00'), 'medium'),
  ('LOG0008', 'STU003', 'EX002', 'TAB_SWITCH', 'The student switched to another browser tab.', TIMESTAMP(DATE_SUB(UTC_DATE(), INTERVAL 18 DAY), '09:47:00'), 'high');

-- ID counters start at the highest demo ID, so the next new record gets the next number
INSERT INTO `counters` (`name`,`value`) VALUES ('student', 8), ('exam', 3), ('question', 25), ('result', 9), ('log', 8), ('support', 0);
