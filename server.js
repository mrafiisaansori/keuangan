const express = require('express');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { checkOverBudget } = require('./budget');
const { verifyPassword, createToken, verifyToken } = require('./auth');
const { currentPeriod, toDateStr } = require('./period');

function toDateTimeStr(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${toDateStr(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const { loginUser, passwordSalt, passwordHash, ...dbConfig } = config;
const pool = mysql.createPool(dbConfig);

const COOKIE_NAME = 'kg_session';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 hari
// ponytail: secret di-generate ulang tiap restart proses -> semua sesi logout saat server restart.
// Kalau itu mengganggu, pindahkan ke field "sessionSecret" di config.json dan baca dari sana.
const SESSION_SECRET = crypto.randomBytes(32).toString('hex');

// ponytail: rate-limit di memori per proses, reset saat restart -> cukup untuk instance tunggal.
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCK_MS = 5 * 60 * 1000;

function isLocked(ip) {
  const rec = loginAttempts.get(ip);
  return !!(rec && rec.lockUntil && rec.lockUntil > Date.now());
}
function registerFail(ip) {
  const rec = loginAttempts.get(ip) || { count: 0 };
  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS) rec.lockUntil = Date.now() + LOCK_MS;
  loginAttempts.set(ip, rec);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=${SESSION_MAX_AGE / 1000}; SameSite=Lax${secure}`);
}

function requireAuth(req, res, next) {
  const cookies = parseCookies(req);
  if (verifyToken(cookies[COOKIE_NAME], SESSION_SECRET)) return next();
  if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'Belum login' });
  return res.redirect('/login.html');
}

async function getPeriodStartDay() {
  const [[row]] = await pool.query('SELECT period_start_day FROM app_settings WHERE id = 1');
  return row ? row.period_start_day : 1;
}

const app = express();
app.use(express.json());

app.post('/api/login', (req, res) => {
  const ip = req.ip;
  if (isLocked(ip)) return res.status(429).json({ error: 'Terlalu banyak percobaan gagal, coba lagi beberapa menit lagi.' });
  const { username, password } = req.body || {};
  const ok = config.loginUser && config.passwordHash && config.passwordSalt &&
    username === config.loginUser &&
    verifyPassword(password || '', config.passwordSalt, config.passwordHash);
  if (!ok) {
    registerFail(ip);
    return res.status(401).json({ error: 'Username atau password salah' });
  }
  loginAttempts.delete(ip);
  setSessionCookie(res, createToken(SESSION_SECRET, SESSION_MAX_AGE));
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
  res.json({ ok: true });
});

app.get(['/', '/index.html'], requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', requireAuth);

app.get('/api/settings', async (req, res) => {
  try {
    res.json({ periodStartDay: await getPeriodStartDay() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/settings', async (req, res) => {
  try {
    const day = Number(req.body?.periodStartDay);
    if (!(day >= 1 && day <= 31)) return res.status(400).json({ error: 'Tanggal mulai periode harus 1-31' });
    await pool.execute(
      'INSERT INTO app_settings (id, period_start_day) VALUES (1, ?) ON DUPLICATE KEY UPDATE period_start_day = VALUES(period_start_day)',
      [day]
    );
    res.json({ periodStartDay: day });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/data', async (req, res) => {
  try {
    const periodStartDay = await getPeriodStartDay();
    const { start, end } = currentPeriod(periodStartDay);
    const startStr = toDateStr(start);
    const endStr = toDateStr(end);

    const [categoryRows] = await pool.query('SELECT id, kategori, tipe, limit_amount AS `limit` FROM budgets ORDER BY id');
    const [spentRows] = await pool.query(
      "SELECT kategori, SUM(jumlah) AS total FROM transactions WHERE tipe = 'Pengeluaran' AND tanggal BETWEEN ? AND ? GROUP BY kategori",
      [startStr, endStr]
    );
    const [totalRows] = await pool.query(
      'SELECT tipe, SUM(jumlah) AS total FROM transactions WHERE tanggal BETWEEN ? AND ? GROUP BY tipe',
      [startStr, endStr]
    );
    const [tx] = await pool.query(
      'SELECT id, tanggal, tipe, kategori, jumlah, catatan, created_at FROM transactions WHERE tanggal BETWEEN ? AND ? ORDER BY tanggal DESC, id DESC LIMIT 500',
      [startStr, endStr]
    );

    const spent = {};
    spentRows.forEach(r => { spent[r.kategori] = Number(r.total); });

    const budgets = categoryRows
      .filter(b => b.tipe === 'Pengeluaran')
      .map(b => ({
        id: b.id,
        kategori: b.kategori,
        limit: Number(b.limit),
        terpakai: spent[b.kategori] || 0,
        sisa: Number(b.limit) - (spent[b.kategori] || 0)
      }));

    const incomeCategories = categoryRows
      .filter(b => b.tipe === 'Pemasukan')
      .map(b => ({ id: b.id, kategori: b.kategori }));

    const totalMasuk = Number((totalRows.find(r => r.tipe === 'Pemasukan') || {}).total || 0);
    const totalKeluar = Number((totalRows.find(r => r.tipe === 'Pengeluaran') || {}).total || 0);

    res.json({
      transactions: tx.map(t => ({
        id: t.id,
        tanggal: toDateStr(t.tanggal),
        tipe: t.tipe,
        kategori: t.kategori,
        jumlah: Number(t.jumlah),
        catatan: t.catatan,
        createdAt: toDateTimeStr(t.created_at)
      })),
      budgets,
      incomeCategories,
      totalMasuk,
      totalKeluar,
      saldo: totalMasuk - totalKeluar,
      periodStartDay,
      periodStart: startStr,
      periodEnd: endStr
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/transactions', async (req, res) => {
  try {
    const { tipe, kategori, jumlah, tanggal, catatan } = req.body || {};
    if (!tipe || !kategori || !jumlah) return res.status(400).json({ error: 'Data tidak lengkap' });
    const jml = Number(jumlah);
    if (!(jml > 0)) return res.status(400).json({ error: 'Jumlah harus lebih dari 0' });

    const txDate = tanggal ? new Date(tanggal + 'T00:00:00') : new Date();
    const txDateStr = toDateStr(txDate);

    let warning = null;
    if (tipe === 'Pengeluaran') {
      const periodStartDay = await getPeriodStartDay();
      const { start, end } = currentPeriod(periodStartDay, txDate);
      const [[spentRow]] = await pool.query(
        "SELECT COALESCE(SUM(jumlah), 0) AS total FROM transactions WHERE tipe = 'Pengeluaran' AND kategori = ? AND tanggal BETWEEN ? AND ?",
        [kategori, toDateStr(start), toDateStr(end)]
      );
      const [[budgetRow]] = await pool.query(
        'SELECT limit_amount FROM budgets WHERE kategori = ?',
        [kategori]
      );
      if (budgetRow) {
        const result = checkOverBudget(Number(spentRow.total), jml, Number(budgetRow.limit_amount));
        if (result.melebihi) warning = { limit: Number(budgetRow.limit_amount), totalSetelah: result.totalSetelah, selisih: result.selisih };
      }
    }

    await pool.execute(
      'INSERT INTO transactions (tanggal, tipe, kategori, jumlah, catatan) VALUES (?, ?, ?, ?, ?)',
      [txDateStr, tipe, kategori, jml, catatan || '']
    );

    res.json({ ok: true, warning });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/transactions/:id', async (req, res) => {
  try {
    const [result] = await pool.execute('DELETE FROM transactions WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Transaksi tidak ditemukan' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/budgets', async (req, res) => {
  try {
    const { kategori, limit, tipe } = req.body || {};
    if (tipe !== 'Pemasukan' && tipe !== 'Pengeluaran') return res.status(400).json({ error: 'Tipe tidak valid' });
    const lim = tipe === 'Pengeluaran' ? Number(limit) : null;
    if (!kategori || (tipe === 'Pengeluaran' && !(lim > 0))) {
      return res.status(400).json({ error: 'Kategori wajib diisi (limit > 0 untuk Pengeluaran)' });
    }
    const [result] = await pool.execute(
      'INSERT INTO budgets (kategori, tipe, limit_amount) VALUES (?, ?, ?)',
      [String(kategori).trim(), tipe, lim]
    );
    res.json({ id: result.insertId, kategori: String(kategori).trim(), tipe, limit: lim });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Kategori sudah ada' });
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/budgets/:id', async (req, res) => {
  try {
    const { kategori, limit, tipe } = req.body || {};
    if (tipe !== 'Pemasukan' && tipe !== 'Pengeluaran') return res.status(400).json({ error: 'Tipe tidak valid' });
    const lim = tipe === 'Pengeluaran' ? Number(limit) : null;
    if (!kategori || (tipe === 'Pengeluaran' && !(lim > 0))) {
      return res.status(400).json({ error: 'Kategori wajib diisi (limit > 0 untuk Pengeluaran)' });
    }
    const kategoriBaru = String(kategori).trim();

    const [[existing]] = await pool.query('SELECT kategori FROM budgets WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Budget tidak ditemukan' });

    await pool.execute('UPDATE budgets SET kategori = ?, tipe = ?, limit_amount = ? WHERE id = ?', [kategoriBaru, tipe, lim, req.params.id]);
    if (existing.kategori !== kategoriBaru) {
      // Rename dibawa juga ke transaksi lama, biar histori tetap nyambung ke limit yang benar.
      await pool.execute('UPDATE transactions SET kategori = ? WHERE kategori = ?', [kategoriBaru, existing.kategori]);
    }
    res.json({ id: Number(req.params.id), kategori: kategoriBaru, tipe, limit: lim });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Kategori sudah ada' });
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/budgets/:id', async (req, res) => {
  try {
    await pool.execute('DELETE FROM budgets WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3001; // 3000 dipakai project lain di laptop ini
const HOST = process.env.HOST || '127.0.0.1'; // localhost only; expose lewat reverse proxy (Nginx), bukan langsung
app.listen(PORT, HOST, () => console.log(`Jalan di http://${HOST}:${PORT}`));
