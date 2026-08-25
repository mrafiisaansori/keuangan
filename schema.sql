CREATE DATABASE IF NOT EXISTS keuangan;
USE keuangan;

-- "budgets" menyimpan kategori Pemasukan & Pengeluaran sekaligus (dibedakan kolom tipe).
-- limit_amount cuma dipakai/divalidasi untuk kategori Pengeluaran, boleh NULL untuk Pemasukan.
CREATE TABLE IF NOT EXISTS budgets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  kategori VARCHAR(100) NOT NULL UNIQUE,
  tipe ENUM('Pemasukan','Pengeluaran') NOT NULL DEFAULT 'Pengeluaran',
  limit_amount DECIMAL(14,2) NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tanggal DATE NOT NULL,
  tipe ENUM('Pemasukan','Pengeluaran') NOT NULL,
  kategori VARCHAR(100) NOT NULL,
  jumlah DECIMAL(14,2) NOT NULL,
  catatan VARCHAR(255) DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tipe_kategori (tipe, kategori)
);

-- Satu baris tetap (id=1): tanggal mulai siklus periode budget (1-31).
-- Akhir periode otomatis = (period_start_day - 1) bulan berikutnya.
CREATE TABLE IF NOT EXISTS app_settings (
  id INT PRIMARY KEY,
  period_start_day INT NOT NULL DEFAULT 1
);
INSERT IGNORE INTO app_settings (id, period_start_day) VALUES (1, 1);

-- Seed data dipindah dari sheet "Budgeting" milikmu (kolom Kategori/Limit).
INSERT INTO budgets (kategori, tipe, limit_amount) VALUES
  ('Nafkah Istri', 'Pengeluaran', 1000000.00),
  ('Uang Transportasi (4 Work Days/Week)', 'Pengeluaran', 1000000.00),
  ('Uang Jajan', 'Pengeluaran', 850000.00),
  ('Internet Wifi', 'Pengeluaran', 150000.00),
  ('Internet Paket Data', 'Pengeluaran', 100000.00),
  ('Tabungan', 'Pengeluaran', 3500000.00),
  ('Gaji', 'Pemasukan', NULL)
ON DUPLICATE KEY UPDATE tipe = VALUES(tipe), limit_amount = VALUES(limit_amount);
