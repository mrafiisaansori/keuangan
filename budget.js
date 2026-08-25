function parseAmount(v) {
  if (typeof v === 'number') return v;
  if (!v) return 0;
  return Number(String(v).replace(/[^0-9.-]/g, '')) || 0;
}

function checkOverBudget(existing, tambahan, limit) {
  const totalSetelah = existing + tambahan;
  if (totalSetelah > limit) return { melebihi: true, totalSetelah, selisih: totalSetelah - limit };
  return { melebihi: false, totalSetelah };
}

module.exports = { parseAmount, checkOverBudget };
