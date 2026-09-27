import { useMemo, useState } from "react";
import { strFromU8, unzipSync } from "fflate";
import { AED } from "../lib/helpers";

const PRINTERS = {
  bambuA1: { label: "Bambu Lab A1", watts: 120 },
  snapmakerU1: { label: "Snapmaker U1", watts: 180 },
};

const PRICE_LEVELS = {
  moderate: { label: "Moderate", multiplier: 2.5 },
};

const AUTOMATIC_LABOR_RATE = 0.25;

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
  return seconds || Number(value) || 0;
}

function sumNumbers(value) {
  const values = String(value).match(/\d+(?:\.\d+)?/g) || [];
  return values.reduce((sum, number) => sum + Number(number), 0);
}

function parseGcode(text) {
  const timePatterns = [
    /;\s*model printing time\s*:\s*([^\r\n]+)/i,
    /;\s*estimated printing time[^=]*=\s*([^\r\n]+)/i,
    /;TIME:\s*([\d.]+)/i,
  ];
  const weightPatterns = [
    /;\s*total filament weight \[g\]\s*:\s*([^\r\n]+)/i,
    /;\s*filament used \[g\]\s*=\s*([^\r\n]+)/i,
    /;\s*filament used\s*:\s*([^\r\n]+)/i,
  ];

  let seconds = 0;
  let grams = 0;

  for (const pattern of timePatterns) {
    const match = text.match(pattern);
    if (match) {
      seconds = parseDuration(match[1]);
      break;
    }
  }

  for (const pattern of weightPatterns) {
    const match = text.match(pattern);
    if (match) {
      grams = sumNumbers(match[1]);
      break;
    }
  }

  return { hours: seconds / 3600, grams };
}

async function readSlicedFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (!file.name.toLowerCase().endsWith(".3mf")) {
    const parsed = parseGcode(new TextDecoder().decode(bytes));
    return { ...parsed, plates: 1 };
  }

  const archive = unzipSync(bytes);
  const allGcode = Object.entries(archive).filter(([name]) => /\.gcode$/i.test(name));
  if (!allGcode.length) throw new Error("This 3MF does not contain sliced G-code. Export a sliced Bambu or Orca 3MF.");

  const plateFiles = allGcode.filter(([name]) => /(?:^|\/)plate_?\d+\.gcode$/i.test(name));
  const entries = plateFiles.length ? plateFiles : allGcode;
  const totals = entries.reduce(
    (sum, [, data]) => {
      const parsed = parseGcode(strFromU8(data));
      return { grams: sum.grams + parsed.grams, hours: sum.hours + parsed.hours };
    },
    { grams: 0, hours: 0 },
  );

  return { ...totals, plates: entries.length };
}

export default function PrintCalculator({ filaments = [], onAdd, onAdded }) {
  const [printerKey, setPrinterKey] = useState("bambuA1");
  const [name, setName] = useState("");
  const [filamentId, setFilamentId] = useState("");
  const [grams, setGrams] = useState(0);
  const [hours, setHours] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [spoolPrice, setSpoolPrice] = useState(75);
   const [packaging, setPackaging] = useState(0);
  const [shipping, setShipping] = useState(0);
  const [customPrice, setCustomPrice] = useState("");
  const [priceLevel, setPriceLevel] = useState("moderate");
  const [plates, setPlates] = useState(1);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const result = useMemo(() => {
    if (!(grams > 0) || !(hours > 0) || !(spoolPrice > 0) || !(quantity > 0)) return null;
    const printer = PRINTERS[printerKey];
    const material = grams * spoolPrice / 1000;
    const electricity = hours * (printer.watts / 1000) * 0.3;
    const laborOther = (material + electricity) * AUTOMATIC_LABOR_RATE;
    const baseCost = material + electricity + laborOther + packaging + shipping;
    const prices = Object.fromEntries(
      Object.entries(PRICE_LEVELS).map(([key, level]) => {
        const batch = baseCost * level.multiplier;
        const profitPerPiece = (batch - baseCost) / quantity;
        return [key, { batch, perPiece: batch / quantity, profitPerPiece }];
      }),
    );
    return { material, electricity, laborOther, baseCost, prices };
  }, [grams, hours, quantity, spoolPrice, packaging, shipping, printerKey]);

  const enteredCustomPrice = Number(customPrice);
  const hasCustomPrice = customPrice !== "" && Number.isFinite(enteredCustomPrice) && enteredCustomPrice > 0;
  const selectedPrice = result
    ? hasCustomPrice
      ? {
          batch: enteredCustomPrice * quantity,
          perPiece: enteredCustomPrice,
          profitPerPiece: enteredCustomPrice - (result.baseCost / quantity),
        }
      : result.prices[priceLevel]
    : null;
  const availableFilaments = filaments.filter((entry) => entry.stockStatus === "available" && entry.remainingG > 0);
  const selectedFilament = availableFilaments.find((entry) => entry.id === filamentId);

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
      setPlates(parsed.plates);
    } catch (e) {
      setError(e.message || "Could not read this file.");
    } finally {
      setReading(false);
    }
  };

  const save = async () => {
    if (!result || !selectedPrice || !name.trim()) return;
    setSaving(true);
    try {
      await onAdd({
        id: null,
        name: name.trim(),
        nameAr: "",
        category: "3D Print",
        price: Math.round(selectedPrice.perPiece * 100) / 100,
        description: `${quantity} piece${quantity === 1 ? "" : "s"} · ${grams.toFixed(1)} g total · ${durationText(hours)} · ${hasCustomPrice ? "Custom" : PRICE_LEVELS[priceLevel].label} price`,
        imageUrl: null,
        filamentId: filamentId || null,
        gramsPerUnit: grams / quantity,
      });
      onAdded();
    } catch {
      setError("Could not save the item. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="calculator-card" style={s.card}>
      <h2 style={s.h2}>Slice & price</h2>
      <p style={s.sub}>Upload a sliced G-code or Bambu/Orca 3MF. All colors and build plates are included.</p>

      <label style={s.field}>
        <span>Filament stock</span>
        <select
          style={s.input}
          value={filamentId}
          onChange={(e) => {
            const nextId = e.target.value;
            setFilamentId(nextId);
            const stock = availableFilaments.find((entry) => entry.id === nextId);
            if (stock?.purchaseCost > 0) setSpoolPrice(stock.purchaseCost);
          }}
        >
          <option value="">No stock deduction</option>
          {availableFilaments.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.material} · {entry.color} · {(entry.remainingG / 1000).toFixed(2)} kg left
            </option>
          ))}
        </select>
      </label>

      {selectedFilament && selectedFilament.purchaseCost <= 0 && (
        <div style={s.error}>Add this filament’s purchase cost in the Filament tab before using it for pricing.</div>
      )}

      <label style={s.field}>
        <span>Printer</span>
        <select style={s.input} value={printerKey} onChange={(e) => setPrinterKey(e.target.value)}>
          {Object.entries(PRINTERS).map(([key, printer]) => <option key={key} value={key}>{printer.label}</option>)}
        </select>
      </label>

      <label style={s.drop}>
        <strong>{reading ? "Reading file…" : "Choose sliced file"}</strong>
        <span>G-code or sliced 3MF</span>
        <input type="file" accept=".gcode,.bgcode,.gco,.g,.gc,.ngc,.3mf" disabled={reading} onChange={(e) => { const file = e.target.files?.[0]; pickFile(file); e.target.value = ""; }} />
      </label>

      {plates > 1 && <div style={s.notice}>{plates} build plates detected. Filament and printing time were combined.</div>}
      {error && <div style={s.error}>{error}</div>}

      <div className="calculator-grid" style={s.grid}>
        <Field label="Item name" value={name} onChange={setName} />
        <Field label="Total filament (g)" type="number" value={grams} onChange={(value) => setGrams(Number(value))} />
        <Field label="Total print time (hours)" type="number" value={hours} onChange={(value) => setHours(Number(value))} />
        <Field label="Quantity made" type="number" value={quantity} onChange={(value) => setQuantity(Math.max(1, Number(value) || 1))} />
        <Field label="Spool price (AED / 1 kg)" type="number" value={spoolPrice} onChange={(value) => setSpoolPrice(Number(value))} />
         <Field label="Packaging (AED)" type="number" value={packaging} onChange={(value) => setPackaging(Math.max(0, Number(value) || 0))} />
        <Field label="Shipping paid by you (AED)" type="number" value={shipping} onChange={(value) => setShipping(Math.max(0, Number(value) || 0))} />
        <Field label="My selling price per item (AED, optional)" type="number" value={customPrice} onChange={setCustomPrice} />
      </div>

      {result && (
        <>
          <div style={s.cost}>
            <span>Material <strong>{AED(result.material)}</strong></span>
            <span>Electricity <strong>{AED(result.electricity)}</strong></span>
            <span>Automatic labor (25%) <strong>{AED(result.laborOther)}</strong></span>
            <span>Packaging <strong>{AED(packaging)}</strong></span>
            <span>Shipping <strong>{AED(shipping)}</strong></span>
            <span style={s.costTotal}>Estimated cost <strong>{AED(result.baseCost)}</strong></span>
          </div>

          <div className="price-levels" style={{ ...s.levels, gridTemplateColumns: "1fr" }}>
            {Object.entries(PRICE_LEVELS).map(([key, level]) => (
              <button key={key} style={{ ...s.level, ...(priceLevel === key ? s.levelActive : {}) }} onClick={() => setPriceLevel(key)}>
                <span>{hasCustomPrice ? "Your price" : level.label}</span>
                <strong>{AED(selectedPrice.perPiece)}</strong>
                <small>per piece · batch {AED(selectedPrice.batch)}</small>
                <small style={{ color: selectedPrice.profitPerPiece >= 0 ? "#166534" : "#B91C1C", fontWeight: 800 }}>
                  Profit per item {AED(selectedPrice.profitPerPiece)}
                </small>
              </button>
            ))}
          </div>
        </>
      )}

      <button style={{ ...s.button, opacity: !result || !name.trim() || saving ? 0.55 : 1 }} disabled={!result || !name.trim() || saving} onClick={save}>
        {saving ? "Adding…" : `Add ${hasCustomPrice ? "your" : PRICE_LEVELS[priceLevel].label} price to Items menu`}
      </button>
    </div>
  );
}

function Field({ label, type = "text", value, onChange }) {
  return (
    <label style={s.field}>
      <span>{label}</span>
      <input style={s.input} type={type} min={type === "number" ? 0 : undefined} step={type === "number" ? "0.01" : undefined} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

const s = {
  card: { maxWidth: 760, margin: "0 auto", padding: 24, background: "#fff", border: "1.5px solid #E4DFD3", borderRadius: 14 },
  h2: { margin: 0, fontSize: 24 },
  sub: { margin: "6px 0 22px", color: "#8A7F6D", fontSize: 13.5 },
  drop: { display: "grid", gap: 7, marginTop: 18, padding: 22, border: "1.5px dashed #DCD5C6", borderRadius: 10, textAlign: "center", cursor: "pointer" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12, marginTop: 18 },
  field: { display: "grid", gap: 5, color: "#6B6355", fontSize: 12, fontWeight: 700 },
  input: { width: "100%", boxSizing: "border-box", padding: "10px 11px", border: "1.5px solid #DCD5C6", borderRadius: 8, fontSize: 14 },
  notice: { marginTop: 12, padding: 10, color: "#166534", background: "#F0FDF4", borderRadius: 8, fontSize: 13, fontWeight: 700 },
  error: { marginTop: 12, padding: 10, color: "#B3451D", background: "#FFF1EC", borderRadius: 8, fontSize: 13 },
  cost: { display: "grid", gap: 8, marginTop: 20, padding: 16, borderRadius: 10, background: "#F8FAFC", color: "#475569", fontSize: 12.5 },
  costTotal: { display: "flex", justifyContent: "space-between", marginTop: 4, paddingTop: 10, borderTop: "1px solid #CBD5E1", color: "#16324F", fontSize: 15 },
  levels: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 14 },
  level: { display: "grid", gap: 5, padding: 14, border: "1.5px solid #DCD5C6", borderRadius: 10, background: "#fff", color: "#1B2A3D", cursor: "pointer", textAlign: "left" },
  levelActive: { borderColor: "#E8792D", background: "#FFF5ED", boxShadow: "0 0 0 1px #E8792D" },
  button: { width: "100%", marginTop: 14, padding: 13, border: 0, borderRadius: 8, background: "#E8792D", color: "#fff", fontSize: 14, fontWeight: 800, cursor: "pointer" },
};
