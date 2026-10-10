// Proof that a saved invoice really moved stock: compares the filament rows before and after the save.
const label = (filament) => `${filament.material} ${filament.color}`.trim();
const spools = (filament, grams) => Math.floor(Number(grams || 0) / Number(filament.spoolWeightG || 1000));

// lines: invoice lines. before/after: filament lists (from fetchFilaments). Returns { moved, ok, text }.
export function describeStockChange(lines, before, after) {
  const wanted = new Map();
  for (const line of lines || []) {
    if (!line.filamentId) continue;
    const grams = Number(line.gramsPerUnit || 0) * Number(line.qty || 0);
    wanted.set(line.filamentId, (wanted.get(line.filamentId) || 0) + grams);
  }
  if (!wanted.size) return { moved: false, ok: true, text: "" };

  const parts = [];
  let ok = true;
  for (const [id, grams] of wanted) {
    const was = before.find((row) => row.id === id);
    const now = after.find((row) => row.id === id);
    if (!was || !now) continue;
    const taken = Number(was.remainingG) - Number(now.remainingG);
    if (Math.abs(taken - grams) > 0.5) ok = false;
    parts.push(`${label(now)}: ${spools(now, was.remainingG)} → ${spools(now, now.remainingG)} spools`);
  }
  return {
    moved: true,
    ok,
    text: ok ? `Stock updated · ${parts.join(" · ")}` : `Stock did NOT change as expected (${parts.join(" · ")}). Check the Stock tab before selling.`,
  };
}
