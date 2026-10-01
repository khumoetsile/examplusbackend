-- Run ONLY on a database created from the earlier schema (new installs already have these).
ALTER TABLE products ADD COLUMN sale_price DECIMAL(10,2) NULL, ADD COLUMN sale_starts DATETIME NULL, ADD COLUMN sale_ends DATETIME NULL, ADD COLUMN sale_label VARCHAR(60) NULL;
ALTER TABLE orders ADD COLUMN subtotal DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER user_id, ADD COLUMN discount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER subtotal, ADD COLUMN voucher_code VARCHAR(40) NULL AFTER discount;
UPDATE orders SET subtotal = total WHERE subtotal = 0;
