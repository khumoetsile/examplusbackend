-- Elevate Skills - Past Exam Papers Portal
-- Import this file in phpMyAdmin (select your database first, then Import).
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('learner','admin') NOT NULL DEFAULT 'learner',
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS qualifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(500) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS subjects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  qualification_id INT NOT NULL,
  name VARCHAR(120) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_subject (qualification_id, name),
  FOREIGN KEY (qualification_id) REFERENCES qualifications(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS papers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  subject_id INT NOT NULL,
  exam_year SMALLINT NOT NULL,
  paper_type VARCHAR(60) NOT NULL DEFAULT 'Paper 1',
  file_name VARCHAR(255) NOT NULL,          -- stored name inside backend/storage/papers (never public)
  original_name VARCHAR(255) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- A product is something a learner can buy: one paper, a subject bundle or a qualification bundle.
CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  type ENUM('paper','subject','qualification') NOT NULL,
  paper_id INT NULL,
  subject_id INT NULL,
  qualification_id INT NULL,
  name VARCHAR(190) NOT NULL,
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  access_days INT NULL,                      -- NULL = permanent access
  sale_price DECIMAL(10,2) NULL,             -- special price; used while the sale window is open
  sale_starts DATETIME NULL,
  sale_ends DATETIME NULL,
  sale_label VARCHAR(60) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE,
  FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
  FOREIGN KEY (qualification_id) REFERENCES qualifications(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
  discount DECIMAL(10,2) NOT NULL DEFAULT 0,
  voucher_code VARCHAR(40) NULL,
  total DECIMAL(10,2) NOT NULL,
  currency VARCHAR(5) NOT NULL,
  status ENUM('pending','paid','failed','cancelled') NOT NULL DEFAULT 'pending',
  dpo_token VARCHAR(100) NULL,
  dpo_trans_ref VARCHAR(100) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at DATETIME NULL,
  KEY idx_token (dpo_token),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS vouchers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL UNIQUE,
  description VARCHAR(190) NULL,
  type ENUM('percent','fixed') NOT NULL DEFAULT 'percent',
  value DECIMAL(10,2) NOT NULL,
  min_total DECIMAL(10,2) NOT NULL DEFAULT 0,
  max_uses INT NULL,                         -- NULL = unlimited
  per_user_limit INT NOT NULL DEFAULT 1,
  used_count INT NOT NULL DEFAULT 0,
  product_id INT NULL,                       -- NULL = any product
  starts_at DATETIME NULL,
  expires_at DATETIME NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  product_id INT NOT NULL,
  name VARCHAR(190) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS entitlements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  product_id INT NOT NULL,
  order_id INT NULL,
  granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NULL,
  revoked TINYINT(1) NOT NULL DEFAULT 0,
  KEY idx_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS audit_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  action VARCHAR(80) NOT NULL,
  detail TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS settings (
  k VARCHAR(60) PRIMARY KEY,
  v VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO settings (k, v) VALUES ('currency', 'BWP');

INSERT IGNORE INTO qualifications (id, code, name, description, sort_order) VALUES
 (1, 'BGCSE', 'BGCSE', 'Botswana General Certificate of Secondary Education', 1),
 (2, 'PSLE',  'PSLE',  'Primary School Leaving Examination', 2),
 (3, 'JC',    'JC',    'Junior Certificate', 3);

-- Sample subjects (edit from the admin area). The admin account is created by `npm run seed` in /backend.
INSERT IGNORE INTO subjects (qualification_id, name) VALUES
 (1,'Biology'),(1,'Mathematics'),(1,'English Language'),
 (2,'Mathematics'),(2,'English'),
 (3,'English'),(3,'Mathematics');
