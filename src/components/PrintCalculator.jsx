import { useMemo, useState } from "react";
import { strFromU8, unzipSync } from "fflate";
import { AED } from "../lib/helpers";

const MODES = {
  product: { label: "Product / batch", overhead: 0.4, minimum: 3 },
  personalized: { label: "Personalized item", overhead: 3, minimum: 8 },
  custom: { label: "Custom one-off", overhead: 5, minimum: 15 },
};

function durationText(hours) {
  const minutes = Math.round(hours * 60);
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

function parseDuration(value) {
  let seconds = 0;
  const hours = value.match(/([\d.]+)\s*h/i);
  const minutes = value.match(/([\d.]+)\s*m(?!s)/i);
  const secs = value.match(/([\d.]+)\s*s/i);
  if (hours) seconds += Number(hours[1]) * 3600;
  if (minutes) seconds += Number(minutes[1]) * 60;
  if (secs) seconds += Number(secs[1]);
  return seconds || (Number(value) || 0);
}

function parseGcode(text) {
  const timePatterns = [
    /;\s*model printing time\s*:\s*([^\r\n]+)/i,
    /;\s*estimated printing time[^=]*=\s*([^\r\n]+)/i,
    /;TIME:\s*([\d.]+)/i,
  ];
  const weightPatterns = [
    /;\s*total filament weight \[g\]\s*:\s*([\d.]+)/i,
    /;\s*filament used \[g\]\s*=\s*([\d.]+)/i,
    /;\s*filament used\s*:\s*([\d.]+)\s*g/i,
  ];
  let seconds = 0;
  let grams = 0;
  for (const pattern of timePatterns) {
    const match = text.match(pattern);
    if (match) { seconds = parseDuration(match[1]); break; }
  }
  for (const pattern of weightPatterns) {
    const match = text.match(pattern);
    if (match) { grams = Number(match[1]); break; }
  }
  return { hours: seconds / 3600, grams };
}

async function readSlicedFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (file.name.toLowerCase().endsWith(".3mf")) {
    const archive = unzipSync(bytes);
    const entries = Object.entries(archive)
      .filter(([name]) => /\.gcode$/i.test(name))
      .sort((a, b) => b[1].length - a[1].length);
    if (!entries.length) throw new Error("This 3MF does not contain sliced G-code. Export a sliced Bambu or Orca 3MF.");
    return parseGcode(strFromU8(entries[0][1]));
  }
  return parseGcode(new TextDecoder().decode(bytes));
}

export default function PrintCalculator({ onAdd, onAdded }) {
  const [mode, setMode] = useState("product");
  const [name, setName] = useState("");
  const [grams, setGrams] = useState(0);
  const [hours, setHours] = useState(0);
  const [spoolPrice, setSpoolPrice] = useState(75);
  const [margin, setMargin] = useState(40);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const result = useMemo(() => {
    if (!(grams > 0) || !(hours > 0) || !(spoolPrice > 0) || margin >= 100) return null;
    const material = grams * spoolPrice / 1000;
    const electricity = hours * 0.11 * 0.3;
    const cost = material + electricity + MODES[mode].overhead;
    const calculated = cost / (1 - margin / 100);
    const price = Math.max(calculated, MODES[mode].minimum);
    return { material, electricity, cost, price, profit: price - cost };
  }, [grams, hours, spoolPrice, margin, mode]);

  const pickFile = async (file) => {
    if (!file) return;
    setReading(true);
    setError("");
    try {
      const parsed = await readSlicedFile(file);
      if (!(parsed.grams > 0) || !(parsed.hours > 0)) throw new Error("Print time or filament weight was not found. Enter the missing values manually.");
      setName(file.name.replace(/(\.gcode)?\.3mf$|\.(bgcode|gcode|gco|gc|ngc|g)$/i, ""));
      setGrams(Math.round(parsed.grams * 100) / 100);
      setHours(Math.round(parsed.hours * 100) / 100);
    } catch (e) {
      setError(e.message || "Could not read this file.");
    } finally {
      setReading(false);
    }
  };

  const save = async () => {
    if (!result || !name.trim()) return;
    setSaving(true);
    try {
      await onAdd({
        id: null,
        name: name.trim(),
        nameAr: "",
        category: "3D Print",
        price: Math.round(result.price * 100) / 100,
        description: `${grams.toFixed(1)} g filament · ${durationText(hours)} · ${MODES[mode].label}`,
        imageUrl: null,
      });
      onAdded();
    } catch {
      setError("Could not save the item. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={s.card}>
      <h2 style={s.h2}>Slice & price</h2>
      <p style={s.sub}>Upload a sliced G-code or Bambu/Orca 3MF. The file stays in this browser.</p>

      <div style={s.modeGrid}>
        {Object.entries(MODES).map(([key, value]) => (
          <label key={key} style={{ ...s.mode, ...(mode === key ? s.modeActive : {}) }}>
            <input type="radio" name="price-mode" checked={mode === key} onChange={() => setMode(key)} />
            <strong>{value.label}</strong>
            <small>AED {value.minimum} minimum</small>
          </label>
        ))}
      </div>

      <label style={s.drop}>
        <strong>{reading ? "Reading file…" : "Choose sliced file"}</strong>
        <span>G-code or sliced 3MF</span>
        <input type="file" accept=".gcode,.bgcode,.gco,.g,.gc,.ngc,.3mf" disabled={reading} onChange={(e) => { const file = e.target.files?.[0]; pickFile(file); e.target.value = ""; }} />
      </label>

      {error && <div style={s.error}>{error}</div>}

      <div style={s.grid}>
        <Field label="Item name" value={name} onChange={setName} />
        <Field label="Filament (g)" type="number" value={grams} onChange={(v) => setGrams(Number(v))} />
        <Field label="Print time (hours)" type="number" value={hours} onChange={(v) => setHours(Number(v))} />
        <Field label="Spool price (AED)" type="number" value={spoolPrice} onChange={(v) => setSpoolPrice(Number(v))} />
        <Field label="Profit margin (%)" type="number" value={margin} onChange={(v) => setMargin(Number(v))} />
      </div>

      <div style={s.result}>
        <span>Suggested selling price</span>
        <strong>{result ? AED(result.price) : "—"}</strong>
        {result && <small>Cost {AED(result.cost)} · Profit {AED(result.profit)}</small>}
      </div>

      <button style={{ ...s.button, opacity: !result || !name.trim() || saving ? 0.55 : 1 }} disabled={!result || !name.trim() || saving} onClick={save}>
        {saving ? "Adding…" : "Add to Items menu"}
      </button>
    </div>
  );
}

function Field({ label, type = "text", value, onChange }) {
  return <label style={s.field}><span>{label}</span><input style={s.input} type={type} min={type === "number" ? 0 : undefined} step={type === "number" ? "0.01" : undefined} value={value} onChange={(e) => onChange(e.target.value)} /></label>;
}

const s = {
  card: { maxWidth: 760, margin: "0 auto", padding: 24, background: "#fff", border: "1.5px solid #E4DFD3", borderRadius: 14 },
  h2: { margin: 0, fontSize: 24 },
  sub: { margin: "6px 0 22px", color: "#8A7F6D", fontSize: 13.5 },
  modeGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10 },
  mode: { display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 8px", padding: 12, border: "1.5px solid #DCD5C6", borderRadius: 9, cursor: "pointer" },
  modeActive: { borderColor: "#E8792D", background: "#FFF5ED" },
  drop: { display: "grid", gap: 7, marginTop: 18, padding: 22, border: "1.5px dashed #DCD5C6", borderRadius: 10, textAlign: "center", cursor: "pointer" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12, marginTop: 18 },
  field: { display: "grid", gap: 5, color: "#6B6355", fontSize: 12, fontWeight: 700 },
  input: { width: "100%", boxSizing: "border-box", padding: "10px 11px", border: "1.5px solid #DCD5C6", borderRadius: 8, fontSize: 14 },
  result: { display: "grid", gap: 6, marginTop: 20, padding: 20, borderRadius: 10, background: "#F1F6F5", textAlign: "center" },
  button: { width: "100%", marginTop: 14, padding: 13, border: 0, borderRadius: 8, background: "#E8792D", color: "#fff", fontSize: 14, fontWeight: 800, cursor: "pointer" },
  error: { marginTop: 12, padding: 10, color: "#B3451D", background: "#FFF1EC", borderRadius: 8, fontSize: 13 },
};
