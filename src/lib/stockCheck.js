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

const norm = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9+ ]/g, " ").replace(/\s+/g, " ").trim();

// Find the spool a line means by its name (e.g. "PLA Matte Red"). Picks the
// longest material+colour match; among equal spools, the one with most stock.
export function matchFilament(name, filaments) {
  const n = ` ${norm(name)} `;
  let best = null;
  for (const f of filaments) {
    if (f.stockStatus && f.stockStatus !== "available") continue;
    const w = Number(f.spoolWeightG || 1000);
    if (Math.floor(Number(f.remainingG || 0) / w) < 1) continue;
    const m = norm(f.material), c = norm(f.color);
    if (!m || !c || !n.includes(` ${m} `) || !n.includes(` ${c} `)) continue;
    const score = m.length + c.length;
    if (!best || score > best.score || (score === best.score && Number(f.remainingG) > Number(best.f.remainingG))) best = { f, score };
  }
  return best ? best.f : null;
}

// Link every unlinked line whose name matches a spool. Returns { lines, linked }.
export function autoLinkLines(lines, filaments) {
  let linked = 0;
  const out = lines.map((l) => {
    if (l.filamentId) return l;
    const f = matchFilament(l.name, filaments);
    if (!f) return l;
    linked += 1;
    return { ...l, filamentId: f.id, gramsPerUnit: Number(f.spoolWeightG || 1000) };
  });
  return { lines: out, linked };
}

// After an invoice EDIT: what happened to the spools the old and new lines touch. Reports the real
// before/after instead of judging it, because an edit can add, remove or change status.
export function describeStockEdit(oldLines, newLines, before, after) {
  const ids = new Set([...(oldLines || []), ...(newLines || [])].map((line) => line.filamentId).filter(Boolean));
  if (!ids.size) return "";
  const parts = [];
  for (const id of ids) {
    const was = before.find((row) => row.id === id);
    const now = after.find((row) => row.id === id);
    if (!was || !now) continue;
    const a = spools(now, was.remainingG);
    const b = spools(now, now.remainingG);
    const moved = Math.abs(Number(was.remainingG) - Number(now.remainingG)) > 0.5;
    parts.push(moved ? `${label(now)}: ${a} → ${b} spools` : `${label(now)}: ${b} spools (unchanged)`);
  }
  return parts.length ? `Stock after this edit · ${parts.join(" · ")}` : "";
}
