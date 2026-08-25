function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

// Siklus periode "gajian": mulai di periodStartDay tiap bulan, berakhir sehari
// sebelum periodStartDay bulan berikutnya. startDay=1 = kalender bulanan biasa.
function currentPeriod(startDay, today = new Date()) {
  const y = today.getFullYear();
  const m = today.getMonth();
  const startThisMonth = Math.min(startDay, daysInMonth(y, m));

  let periodStart, periodEnd;
  if (today.getDate() >= startThisMonth) {
    periodStart = new Date(y, m, startThisMonth);
    const nextIdx = m + 1;
    const nextY = y + Math.floor(nextIdx / 12);
    const nextM = ((nextIdx % 12) + 12) % 12;
    const startNextMonth = Math.min(startDay, daysInMonth(nextY, nextM));
    periodEnd = new Date(nextY, nextM, startNextMonth - 1);
  } else {
    const prevIdx = m - 1;
    const prevY = y + Math.floor(prevIdx / 12);
    const prevM = ((prevIdx % 12) + 12) % 12;
    const startPrevMonth = Math.min(startDay, daysInMonth(prevY, prevM));
    periodStart = new Date(prevY, prevM, startPrevMonth);
    periodEnd = new Date(y, m, startThisMonth - 1);
  }
  return { start: periodStart, end: periodEnd };
}

// Format tanggal lokal (bukan toISOString, biar tidak geser sehari karena UTC).
function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

module.exports = { currentPeriod, toDateStr, daysInMonth };
