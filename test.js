const assert = require('assert');
const { parseAmount, checkOverBudget } = require('./budget');
const { currentPeriod, toDateStr } = require('./period');

assert.strictEqual(parseAmount('1,000,000.00'), 1000000);
assert.strictEqual(parseAmount(500), 500);
assert.strictEqual(parseAmount(''), 0);
assert.strictEqual(parseAmount(null), 0);

assert.strictEqual(checkOverBudget(0, 50000, 100000).melebihi, false);
assert.strictEqual(checkOverBudget(90000, 10000, 100000).melebihi, false);
assert.strictEqual(checkOverBudget(90000, 20000, 100000).melebihi, true);
assert.strictEqual(checkOverBudget(90000, 20000, 100000).selisih, 10000);

// startDay=1 harus persis kalender bulanan biasa
{
  const { start, end } = currentPeriod(1, new Date(2026, 1, 15)); // 15 Feb 2026
  assert.strictEqual(toDateStr(start), '2026-02-01');
  assert.strictEqual(toDateStr(end), '2026-02-28');
}
// siklus gajian tgl 25: kalau hari ini setelah tgl 25, periode = 25 bulan ini - 24 bulan depan
{
  const { start, end } = currentPeriod(25, new Date(2026, 7, 25)); // 25 Agu 2026
  assert.strictEqual(toDateStr(start), '2026-08-25');
  assert.strictEqual(toDateStr(end), '2026-09-24');
}
// kalau hari ini sebelum tgl 25, periode = 25 bulan lalu - 24 bulan ini
{
  const { start, end } = currentPeriod(25, new Date(2026, 7, 10)); // 10 Agu 2026
  assert.strictEqual(toDateStr(start), '2026-07-25');
  assert.strictEqual(toDateStr(end), '2026-08-24');
}
// startDay=31 di bulan pendek (Feb) di-clamp ke tanggal terakhir bulan itu
{
  const { start, end } = currentPeriod(31, new Date(2026, 1, 15)); // 15 Feb 2026 (28 hari)
  assert.strictEqual(toDateStr(start), '2026-01-31');
  assert.strictEqual(toDateStr(end), '2026-02-27');
}

console.log('semua test lolos');
