-- Adds the IGCSE qualification (with sample subjects and unpriced bundles) and a default access period setting.
-- Safe to run on a database that already has these rows.
INSERT IGNORE INTO qualifications (code, name, description, sort_order) VALUES ('IGCSE', 'IGCSE', 'International General Certificate of Secondary Education', 1);

UPDATE qualifications SET sort_order = 2 WHERE code = 'BGCSE';

UPDATE qualifications SET sort_order = 3 WHERE code = 'JC';

UPDATE qualifications SET sort_order = 4 WHERE code = 'PSLE';

INSERT IGNORE INTO subjects (qualification_id, name) SELECT q.id, s.name FROM qualifications q JOIN (SELECT 'Biology' AS name UNION SELECT 'Mathematics' UNION SELECT 'English Language') s WHERE q.code = 'IGCSE';

INSERT INTO products (type, qualification_id, name, price) SELECT 'qualification', q.id, CONCAT(q.code, ' - Complete (All Papers)'), 0 FROM qualifications q WHERE q.code = 'IGCSE' AND NOT EXISTS (SELECT 1 FROM products p WHERE p.type = 'qualification' AND p.qualification_id = q.id);

INSERT INTO products (type, subject_id, name, price) SELECT 'subject', s.id, CONCAT(q.code, ' ', s.name, ' - Complete Collection'), 0 FROM subjects s JOIN qualifications q ON q.id = s.qualification_id WHERE q.code = 'IGCSE' AND NOT EXISTS (SELECT 1 FROM products p WHERE p.type = 'subject' AND p.subject_id = s.id);

-- Empty = lifetime access. Set in Admin > Settings (for example 365 for 12 months).
INSERT IGNORE INTO settings (k, v) VALUES ('default_access_days', '');
