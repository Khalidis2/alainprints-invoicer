import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AED } from "../lib/helpers";
import { fetchScanCodes, forgetScanCode, saveScanCode } from "../lib/storage";

// Scan the label on a Kingroon box (barcode or QR) and see how many spools are in stock.
// The first time a box type is scanned you say which filament it is; the app remembers that code.

const clean = (code) => String(code || "").trim().toUpperCase();
const norm = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9+]+/g, " ").trim();

// Same rule as the store: whole spools = remaining grams / spool weight, per material + colour.
function stockFor(filaments, material, color) {
  const rows = filaments.filter((entry) => entry.stockStatus === "available" && entry.material === material && norm(entry.color) === norm(color));
  const grams = rows.reduce((sum, entry) => sum + Number(entry.remainingG || 0), 0);
  const weight = Number(rows[0]?.spoolWeightG || 1000);
  return { spools: Math.floor(grams / weight), grams, price: Math.max(0, ...rows.map((entry) => Number(entry.sellingPrice || 0))), rows: rows.length };
}

function typeTotal(filaments, material) {
  return filaments
    .filter((entry) => entry.stockStatus === "available" && entry.material === material)
    .reduce((sum, entry) => sum + Math.floor(Number(entry.remainingG || 0) / Number(entry.spoolWeightG || 1000)), 0);
}

// If the label text itself says e.g. "PLA+ Black", suggest that filament.
function guessFromText(text, options) {
  const haystack = ` ${norm(text)} `;
  const hits = options.filter((option) => haystack.includes(` ${norm(option.material)} `) && haystack.includes(` ${norm(option.color)} `));
  return hits.length === 1 ? hits[0] : null;
}

export default function StockScanner({ filaments, onClose, showToast }) {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const foundRef = useRef(false); // a code can be read before the camera finishes starting
  const [codes, setCodes] = useState({});
  const [phase, setPhase] = useState("starting"); // starting | scanning | result
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [typed, setTyped] = useState("");
  const [relink, setRelink] = useState(false);
  const [pickMaterial, setPickMaterial] = useState("");
  const [pickColor, setPickColor] = useState("");
  const [saving, setSaving] = useState(false);

  const options = useMemo(() => {
    const seen = new Map();
    filaments.filter((entry) => entry.stockStatus !== "removed" && entry.material && entry.color && entry.material !== "Payment Test").forEach((entry) => seen.set(`${entry.material}|${entry.color}`, { material: entry.material, color: entry.color }));
    return [...seen.values()].sort((a, b) => a.material.localeCompare(b.material) || a.color.localeCompare(b.color));
  }, [filaments]);
  const materials = useMemo(() => [...new Set(options.map((option) => option.material))], [options]);

  useEffect(() => {
    fetchScanCodes().then(setCodes).catch(() => setError("Couldn't load saved labels. You can still scan."));
  }, []);

  const stopCamera = useCallback(() => {
    try { controlsRef.current?.stop(); } catch { /* already stopped */ }
    controlsRef.current = null;
    const stream = videoRef.current?.srcObject;
    if (stream && stream.getTracks) stream.getTracks().forEach((track) => track.stop());
  }, []);

  const handleCode = useCallback((raw) => {
    const value = clean(raw);
    if (!value) return;
    foundRef.current = true;
    stopCamera();
    try { navigator.vibrate?.(80); } catch { /* optional */ }
    setCode(value);
    setRelink(false);
    setPhase("result");
  }, [stopCamera]);

  const startCamera = useCallback(async () => {
    setError("");
    foundRef.current = false;
    setPhase("starting");
    try {
      // The scanner library is only downloaded when you open the scanner.
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 150 });
      const controls = await reader.decodeFromConstraints({ audio: false, video: { facingMode: { ideal: "environment" } } }, videoRef.current, (result) => {
        if (result) handleCode(result.getText());
      });
      controlsRef.current = controls;
      if (foundRef.current) { controls.stop(); return; }
      setPhase("scanning");
    } catch (cause) {
      setPhase("result");
      setCode("");
      setError(cause?.name === "NotAllowedError" ? "Camera is blocked. Allow the camera for this site in your browser settings, or type the code below." : "Couldn't start the camera. Type the code below instead.");
    }
  }, [handleCode]);

  useEffect(() => {
    startCamera();
    return stopCamera;
  }, [startCamera, stopCamera]);

  const linked = code ? codes[code] : null;
  const skuMatch = code && !linked ? filaments.find((entry) => clean(entry.sku) === code) : null;
  const match = linked || (skuMatch ? { material: skuMatch.material, color: skuMatch.color } : null);
  const guess = code && !match ? guessFromText(code, options) : null;
  const info = match ? stockFor(filaments, match.material, match.color) : null;

  const link = async (target) => {
    if (!target?.material || !target?.color) return;
    setSaving(true);
    try {
      setCodes(await saveScanCode(code, target));
      setRelink(false);
      showToast?.(`Saved: this label is ${target.material} · ${target.color}`);
    } catch {
      showToast?.("Couldn't save the label. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const unlink = async () => {
    if (!window.confirm("Forget this label so you can link it again?")) return;
    try { setCodes(await forgetScanCode(code)); setRelink(true); } catch { showToast?.("Couldn't forget the label"); }
  };

  const scanNext = () => { setCode(""); setTyped(""); setRelink(false); setPickMaterial(""); setPickColor(""); startCamera(); };
  const close = () => { stopCamera(); onClose(); };
  const colourOptions = options.filter((option) => option.material === pickMaterial);

  return (
    <div style={s.overlay} role="dialog" aria-label="Scan a filament label">
      <div style={s.sheet}>
        <div style={s.head}>
          <strong>Scan a filament label</strong>
          <button type="button" style={s.x} onClick={close} aria-label="Close scanner">×</button>
        </div>

        <div style={{ ...s.cameraBox, display: phase === "result" ? "none" : "block" }}>
          <video ref={videoRef} style={s.video} playsInline muted autoPlay />
          <div style={s.frame} aria-hidden="true" />
          <div style={s.hint}>{phase === "starting" ? "Starting camera…" : "Point at the barcode or QR code on the box"}</div>
        </div>

        {phase !== "result" && (
          <form style={s.manual} onSubmit={(event) => { event.preventDefault(); handleCode(typed); }}>
            <input style={s.input} value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="Or type the code on the label" aria-label="Label code" />
            <button type="submit" style={s.secondary} disabled={!typed.trim()}>Look up</button>
          </form>
        )}

        {phase === "result" && (
          <div style={s.body}>
            {error && <div style={s.error}>{error}</div>}
            {code && match && info && !relink && (
              <>
                <div style={s.label}>{match.material}</div>
                <div style={s.big}>{match.color}</div>
                <div style={{ ...s.count, color: info.spools > 0 ? "#047857" : "#B91C1C" }}>{info.spools} {info.spools === 1 ? "spool" : "spools"} in stock</div>
                <div style={s.meta}>
                  {info.grams ? `${Math.round(info.grams).toLocaleString()} g left` : "Sold out"}{info.price ? ` · sells at ${AED(info.price)}` : ""}
                  <br />All {match.material}: {typeTotal(filaments, match.material)} spools
                </div>
              </>
            )}
            {code && match && !info?.rows && !relink && <div style={s.meta}>No stock row for this colour yet. Add it with "Add filament".</div>}
            {code && !match && !relink && (
              <>
                <div style={s.label}>New label</div>
                <div style={s.codeText}>{code}</div>
                <div style={s.meta}>I don't know this label yet. Tell me which filament it is and I will remember it.</div>
                {guess && <button type="button" style={s.primary} disabled={saving} onClick={() => link(guess)}>Yes, it is {guess.material} · {guess.color}</button>}
              </>
            )}
            {code && (!match || relink) && (
              <div style={s.pick}>
                <select style={s.input} value={pickMaterial} onChange={(event) => { setPickMaterial(event.target.value); setPickColor(""); }} aria-label="Filament type">
                  <option value="">Filament type…</option>
                  {materials.map((material) => <option key={material} value={material}>{material}</option>)}
                </select>
                <select style={s.input} value={pickColor} onChange={(event) => setPickColor(event.target.value)} disabled={!pickMaterial} aria-label="Colour">
                  <option value="">Colour…</option>
                  {colourOptions.map((option) => <option key={option.color} value={option.color}>{option.color}</option>)}
                </select>
                <button type="button" style={s.primary} disabled={saving || !pickMaterial || !pickColor} onClick={() => link({ material: pickMaterial, color: pickColor })}>{saving ? "Saving…" : "Save this label"}</button>
              </div>
            )}
            {!code && (
              <form style={s.manual} onSubmit={(event) => { event.preventDefault(); handleCode(typed); }}>
                <input style={s.input} value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="Type the code on the label" aria-label="Label code" />
                <button type="submit" style={s.secondary} disabled={!typed.trim()}>Look up</button>
              </form>
            )}
            <div style={s.actions}>
              <button type="button" style={s.primary} onClick={scanNext}>📷 Scan next</button>
              {code && linked && !relink && <button type="button" style={s.secondary} onClick={unlink}>Wrong filament? Re-link</button>}
              <button type="button" style={s.secondary} onClick={close}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const s = {
  overlay: { position: "fixed", inset: 0, zIndex: 100, background: "rgba(15,23,42,.72)", display: "flex", alignItems: "flex-end", justifyContent: "center" },
  sheet: { width: "min(520px, 100%)", maxHeight: "100dvh", overflowY: "auto", background: "#fff", borderRadius: "18px 18px 0 0", padding: 16, boxSizing: "border-box" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 17, marginBottom: 12 },
  x: { border: 0, background: "#F0EBE1", width: 36, height: 36, borderRadius: "50%", fontSize: 22, cursor: "pointer" },
  cameraBox: { position: "relative", borderRadius: 14, overflow: "hidden", background: "#0B1220", aspectRatio: "4 / 3" },
  video: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  frame: { position: "absolute", inset: "22% 12%", border: "3px solid rgba(255,255,255,.9)", borderRadius: 14, boxShadow: "0 0 0 999px rgba(0,0,0,.28)" },
  hint: { position: "absolute", left: 0, right: 0, bottom: 10, textAlign: "center", color: "#fff", fontSize: 13, fontWeight: 700, textShadow: "0 1px 4px rgba(0,0,0,.7)" },
  manual: { display: "flex", gap: 8, marginTop: 12 },
  input: { flex: 1, minWidth: 0, padding: "12px 12px", border: "1px solid #DCD5C6", borderRadius: 10, fontSize: 16, background: "#fff", color: "#16324F" },
  body: { textAlign: "center", padding: "4px 0 6px" },
  label: { fontSize: 12, fontWeight: 800, letterSpacing: 2, color: "#746A59", textTransform: "uppercase" },
  big: { fontSize: 30, fontWeight: 900, color: "#16324F", margin: "4px 0" },
  count: { fontSize: 26, fontWeight: 900, margin: "8px 0" },
  meta: { color: "#6B6355", fontSize: 14, lineHeight: 1.6, margin: "6px 0 12px" },
  codeText: { fontFamily: "ui-monospace, monospace", fontSize: 16, wordBreak: "break-all", margin: "8px 0", color: "#16324F" },
  pick: { display: "grid", gap: 8, margin: "12px 0" },
  actions: { display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginTop: 8 },
  primary: { minHeight: 46, padding: "0 20px", border: 0, borderRadius: 12, background: "#047857", color: "#fff", fontWeight: 900, fontSize: 15, cursor: "pointer" },
  secondary: { minHeight: 46, padding: "0 16px", border: "1px solid #DCD5C6", borderRadius: 12, background: "#fff", color: "#16324F", fontWeight: 800, fontSize: 14, cursor: "pointer" },
  error: { padding: "10px 12px", borderRadius: 10, background: "#FBE9E7", color: "#8A2D1C", fontSize: 13, margin: "0 0 10px" },
};
