import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AED } from "../lib/helpers";
import { EditFilamentModal } from "./StockEditor";
import { addScanHistory, clearScanHistory, fetchScanCodes, fetchScanHistory, forgetScanCode, readLabelPhoto, saveScanCode } from "../lib/storage";

// Photo of a filament box label -> AI reads it -> how many spools are in stock.
// A barcode / QR scan is kept as a second way. Codes you confirm are remembered.

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

const sure = (confidence) => (confidence >= 0.8 ? "sure" : confidence >= 0.55 ? "fairly sure" : "not sure");

// The row to edit for a filament: the one with the most stock, or any row of that colour if it is sold out.
function rowFor(filaments, material, color) {
  const rows = filaments.filter((entry) => entry.stockStatus !== "removed" && entry.material === material && norm(entry.color) === norm(color));
  return rows.filter((entry) => entry.stockStatus === "available").sort((a, b) => Number(b.remainingG) - Number(a.remainingG))[0] || rows[0] || null;
}

export default function StockScanner({ filaments, onUpdate, onArchive, onClose, showToast }) {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const fileRef = useRef(null);
  const foundRef = useRef(false); // a code can be read before the camera finishes starting
  const [codes, setCodes] = useState({});
  const [phase, setPhase] = useState("choose"); // choose | reading | starting | scanning | result | history
  const [error, setError] = useState("");
  const [typed, setTyped] = useState("");
  const [code, setCode] = useState("");
  const [target, setTarget] = useState(null); // { material, color } once we know the filament
  const [read, setRead] = useState(null); // what the AI read from a photo
  const [preview, setPreview] = useState("");
  const [pickMaterial, setPickMaterial] = useState("");
  const [pickColor, setPickColor] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState([]);
  const [source, setSource] = useState("");
  const loggedRef = useRef(false);
  const [editing, setEditing] = useState(null);
  const [adjusting, setAdjusting] = useState(false);

  const options = useMemo(() => {
    const seen = new Map();
    filaments.filter((entry) => entry.stockStatus !== "removed" && entry.material && entry.color && entry.material !== "Payment Test").forEach((entry) => seen.set(`${entry.material}|${entry.color}`, { material: entry.material, color: entry.color }));
    return [...seen.values()].sort((a, b) => a.material.localeCompare(b.material) || a.color.localeCompare(b.color));
  }, [filaments]);
  const materials = useMemo(() => [...new Set(options.map((option) => option.material))], [options]);

  useEffect(() => {
    fetchScanCodes().then(setCodes).catch(() => { /* optional: the scanner still works without saved labels */ });
  }, []);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const stopCamera = useCallback(() => {
    try { controlsRef.current?.stop(); } catch { /* already stopped */ }
    controlsRef.current = null;
    const stream = videoRef.current?.srcObject;
    if (stream && stream.getTracks) stream.getTracks().forEach((track) => track.stop());
  }, []);
  useEffect(() => stopCamera, [stopCamera]);

  const reset = () => {
    stopCamera();
    setError(""); setCode(""); setTarget(null); setRead(null); setTyped(""); setChoosing(false);
    setPickMaterial(""); setPickColor(""); setPreview(""); setSource("");
    loggedRef.current = false;
    setPhase("choose");
  };

  // ---------- way 1: photo + AI ----------
  const onPhoto = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setPreview(URL.createObjectURL(file));
    setPhase("reading");
    try {
      const result = await readLabelPhoto(file, options, codes);
      loggedRef.current = false;
      setSource("photo");
      setRead(result);
      setCode(clean(result.code));
      const learned = result.code ? codes[clean(result.code)] : null;
      if (result.matched && result.confidence >= 0.55) setTarget({ material: result.material, color: result.color });
      else if (learned) setTarget(learned);
      else {
        setTarget(null);
        if (materials.includes(result.material)) setPickMaterial(result.material);
        const guess = options.find((option) => option.material === result.material && norm(option.color) === norm(result.color));
        if (guess) setPickColor(guess.color);
      }
      setPhase("result");
    } catch (cause) {
      setError(cause?.message || "The AI could not read that photo.");
      setPhase("result");
    }
  };

  // ---------- way 2: barcode / QR ----------
  const handleCode = useCallback((raw) => {
    const value = clean(raw);
    if (!value) return;
    foundRef.current = true;
    loggedRef.current = false;
    setSource("barcode");
    stopCamera();
    try { navigator.vibrate?.(80); } catch { /* optional */ }
    setCode(value);
    setRead(null);
    setChoosing(false);
    setPhase("result");
  }, [stopCamera]);

  const startCamera = useCallback(async () => {
    setError("");
    foundRef.current = false;
    setPhase("starting");
    try {
      // The barcode library is only downloaded if you use this way.
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 150 });
      const controls = await reader.decodeFromConstraints({ audio: false, video: { facingMode: { ideal: "environment" } } }, videoRef.current, (result) => {
        if (result) handleCode(result.getText());
      });
      controlsRef.current = controls;
      if (foundRef.current) { controls.stop(); return; }
      setPhase("scanning");
    } catch (cause) {
      setPhase("choose");
      setError(cause?.name === "NotAllowedError" ? "Camera is blocked. Allow the camera for this site in your browser settings." : "Couldn't start the camera.");
    }
  }, [handleCode]);

  // A barcode that was linked before (or matches a SKU) shows its filament straight away.
  const linked = code && !read ? codes[code] : null;
  const skuMatch = code && !read && !linked ? filaments.find((entry) => clean(entry.sku) === code) : null;
  const known = target || linked || (skuMatch ? { material: skuMatch.material, color: skuMatch.color } : null);
  const info = known ? stockFor(filaments, known.material, known.color) : null;
  const showPickers = phase === "result" && !error && (!known || choosing);
  const colourOptions = options.filter((option) => option.material === pickMaterial);

  // Write each scan to the history once, as soon as we know which filament it is.
  useEffect(() => {
    if (phase !== "result" || error || !known || !info || choosing || loggedRef.current) return;
    loggedRef.current = true;
    addScanHistory({ at: new Date().toISOString(), material: known.material, color: known.color, spools: info.spools, code, text: read?.text || "", source: source || (read ? "photo" : "barcode") })
      .then(setHistory)
      .catch(() => { /* history is optional */ });
  }, [phase, error, known, info, choosing, code, read, source]);

  const openHistory = async () => {
    setError("");
    setPhase("history");
    try { setHistory(await fetchScanHistory()); } catch { setError("Couldn't load the history."); }
  };

  const wipeHistory = async () => {
    if (!window.confirm("Clear the whole scan history?")) return;
    try { await clearScanHistory(); setHistory([]); } catch { showToast?.("Couldn't clear the history"); }
  };

  const confirm = async (chosen) => {
    if (!chosen?.material || !chosen?.color) return;
    setSaving(true);
    loggedRef.current = false; // a corrected answer is logged too
    setTarget(chosen);
    setChoosing(false);
    try {
      if (code) {
        setCodes(await saveScanCode(code, chosen));
        showToast?.(`Saved: label ${code} is ${chosen.material} · ${chosen.color}`);
      }
    } catch {
      showToast?.("Couldn't save the label, but the stock is shown.");
    } finally {
      setSaving(false);
    }
  };

  const forget = async () => {
    if (!code || !window.confirm("Forget this label so you can link it again?")) return;
    try { setCodes(await forgetScanCode(code)); } catch { showToast?.("Couldn't forget the label"); }
    setTarget(null); setChoosing(true);
  };

  // Quick stock change: same rule as the Stock tab (whole spools of 1 kg). It is saved to the shop's database,
  // so the website shows it right away.
  const adjust = async (delta) => {
    const entry = known && rowFor(filaments, known.material, known.color);
    if (!entry || adjusting) return;
    const weight = Number(entry.spoolWeightG || 1000);
    const remainingG = Math.max(0, Number(entry.remainingG || 0) + delta * weight);
    setAdjusting(true);
    try {
      await onUpdate({ ...entry, remainingG, quantitySpools: remainingG / weight });
      showToast?.(`${entry.material} · ${entry.color}: ${Math.floor(remainingG / weight)} in stock. The website is updated.`);
    } catch {
      showToast?.("Couldn't change the stock. Try again.");
    } finally {
      setAdjusting(false);
    }
  };

  // Tapping a row in the history opens that filament, ready to edit.
  const openFromHistory = (entry) => {
    loggedRef.current = true;
    setCode(""); setRead(null); setPreview(""); setChoosing(false); setError("");
    setTarget({ material: entry.material, color: entry.color });
    setSource("history");
    setPhase("result");
  };

  const close = () => { stopCamera(); onClose(); };

  return (
    <>
    <div style={s.overlay} role="dialog" aria-label="Scan a filament label">
      <div style={s.sheet}>
        <div style={s.head}>
          <strong>Scan a filament label</strong>
          <button type="button" style={s.x} onClick={close} aria-label="Close scanner">×</button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} aria-label="Photo of the label" />

        {error && <div style={s.error}>{error}</div>}

        {phase === "choose" && (
          <div style={s.body}>
            <button type="button" style={s.bigBtn} onClick={() => fileRef.current?.click()}>📷 Take a photo of the label</button>
            <div style={s.meta}>The AI reads the label and tells you which filament it is and how many you have.</div>
            <button type="button" style={s.secondary} onClick={startCamera}>Scan a barcode instead</button>
            <button type="button" style={{ ...s.secondary, marginLeft: 8 }} onClick={openHistory}>🕘 History</button>
            <form style={s.manual} onSubmit={(event) => { event.preventDefault(); handleCode(typed); }}>
              <input style={s.input} value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="Or type the code on the label" aria-label="Label code" />
              <button type="submit" style={s.secondary} disabled={!typed.trim()}>Look up</button>
            </form>
          </div>
        )}

        <div style={{ ...s.cameraBox, display: phase === "starting" || phase === "scanning" ? "block" : "none" }}>
          <video ref={videoRef} style={s.video} playsInline muted autoPlay />
          <div style={s.frame} aria-hidden="true" />
          <div style={s.hint}>{phase === "starting" ? "Starting camera…" : "Point at the barcode or QR code"}</div>
        </div>
        {(phase === "starting" || phase === "scanning") && <div style={s.actions}><button type="button" style={s.secondary} onClick={reset}>Back</button></div>}

        {phase === "history" && (
          <div style={s.body}>
            {history.length === 0 && !error && <div style={s.meta}>No scans yet. Scanned labels will show up here.</div>}
            {history.length > 0 && <div style={s.small}>Tap a label to see its stock and edit it.</div>}
            <div style={s.histList}>
              {history.map((entry, index) => {
                const now = stockFor(filaments, entry.material, entry.color).spools;
                return (
                  <button type="button" key={`${entry.at}-${index}`} style={s.histRow} onClick={() => openFromHistory(entry)} aria-label={`Open ${entry.material} ${entry.color}`}>
                    <div style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
                      <div style={s.histTitle}>{entry.material} · {entry.color}</div>
                      <div style={s.small}>{new Date(entry.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {entry.source === "photo" ? "photo" : "barcode"}{entry.code ? ` · ${entry.code}` : ""}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ ...s.histTitle, color: entry.spools > 0 ? "#047857" : "#B91C1C" }}>{entry.spools} then</div>
                      <div style={s.small}>{now} now</div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div style={s.actions}>
              <button type="button" style={s.primary} onClick={reset}>📷 Scan</button>
              {history.length > 0 && <button type="button" style={s.secondary} onClick={wipeHistory}>Clear history</button>}
              <button type="button" style={s.secondary} onClick={close}>Done</button>
            </div>
          </div>
        )}

        {phase === "reading" && (
          <div style={s.body}>
            {preview && <img src={preview} alt="Your photo of the label" style={s.photo} />}
            <div style={s.reading}>Reading the label…</div>
          </div>
        )}

        {phase === "result" && (
          <div style={s.body}>
            {preview && !error && <img src={preview} alt="Your photo of the label" style={{ ...s.photo, maxHeight: 120 }} />}
            {known && info && !choosing && (
              <>
                <div style={s.label}>{known.material}</div>
                <div style={s.big}>{known.color}</div>
                <div style={{ ...s.count, color: info.spools > 0 ? "#047857" : "#B91C1C" }}>{info.spools} {info.spools === 1 ? "spool" : "spools"} in stock</div>
                <div style={s.meta}>
                  {info.grams ? `${Math.round(info.grams).toLocaleString()} g left` : "Sold out"}{info.price ? ` · sells at ${AED(info.price)}` : ""}
                  <br />All {known.material}: {typeTotal(filaments, known.material)} spools
                  {read && <><br /><span style={s.small}>AI read: "{read.text || `${read.material} ${read.color}`}" · {sure(read.confidence)}</span></>}
                </div>
                {!info.rows && <div style={s.meta}>No stock row for this colour yet. Add it with "Add filament".</div>}
                {info.rows > 0 && (
                  <div style={s.actions}>
                    <button type="button" style={s.minus} disabled={adjusting || info.grams <= 0} onClick={() => adjust(-1)}>− 1 spool</button>
                    <button type="button" style={s.plus} disabled={adjusting} onClick={() => adjust(1)}>+ 1 spool</button>
                    <button type="button" style={s.secondary} onClick={() => setEditing(rowFor(filaments, known.material, known.color))}>✏️ Edit price / stock…</button>
                  </div>
                )}
              </>
            )}
            {showPickers && (
              <>
                <div style={s.label}>{read ? "Please confirm" : "New label"}</div>
                {read && <div style={s.meta}>{read.material || read.color ? <>I read <b>{[read.material, read.color].filter(Boolean).join(" · ")}</b> ({sure(read.confidence)}), but it doesn't match your stock exactly.</> : "I couldn't tell which filament this is."}{read.text ? <><br /><span style={s.small}>"{read.text}"</span></> : null}</div>}
                {!read && code && <><div style={s.codeText}>{code}</div><div style={s.meta}>I don't know this label yet. Tell me which filament it is and I will remember it.</div></>}
                <div style={s.pick}>
                  <select style={s.input} value={pickMaterial} onChange={(event) => { setPickMaterial(event.target.value); setPickColor(""); }} aria-label="Filament type">
                    <option value="">Filament type…</option>
                    {materials.map((material) => <option key={material} value={material}>{material}</option>)}
                  </select>
                  <select style={s.input} value={pickColor} onChange={(event) => setPickColor(event.target.value)} disabled={!pickMaterial} aria-label="Colour">
                    <option value="">Colour…</option>
                    {colourOptions.map((option) => <option key={option.color} value={option.color}>{option.color}</option>)}
                  </select>
                  <button type="button" style={s.primary} disabled={saving || !pickMaterial || !pickColor} onClick={() => confirm({ material: pickMaterial, color: pickColor })}>{saving ? "Saving…" : "Show stock"}</button>
                </div>
              </>
            )}
            <div style={s.actions}>
              <button type="button" style={s.primary} onClick={reset}>📷 Scan next</button>
              {known && !choosing && <button type="button" style={s.secondary} onClick={() => (code && (linked || read) ? forget() : setChoosing(true))}>Wrong filament?</button>}
              <button type="button" style={s.secondary} onClick={close}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
    {editing && <EditFilamentModal entry={{ ...editing }} onSave={onUpdate} onRemove={async (id) => { await onArchive(id); }} onClose={() => setEditing(null)} showToast={showToast || (() => {})} />}
    </>
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
  bigBtn: { width: "100%", minHeight: 64, border: 0, borderRadius: 14, background: "#047857", color: "#fff", fontWeight: 900, fontSize: 18, cursor: "pointer" },
  photo: { display: "block", margin: "0 auto 10px", maxWidth: "100%", maxHeight: 220, borderRadius: 12, objectFit: "contain" },
  reading: { fontWeight: 800, color: "#16324F", margin: "6px 0 10px" },
  label: { fontSize: 12, fontWeight: 800, letterSpacing: 2, color: "#746A59", textTransform: "uppercase" },
  big: { fontSize: 30, fontWeight: 900, color: "#16324F", margin: "4px 0" },
  count: { fontSize: 26, fontWeight: 900, margin: "8px 0" },
  meta: { color: "#6B6355", fontSize: 14, lineHeight: 1.6, margin: "8px 0 12px" },
  small: { fontSize: 12, color: "#8A8170" },
  codeText: { fontFamily: "ui-monospace, monospace", fontSize: 16, wordBreak: "break-all", margin: "8px 0", color: "#16324F" },
  pick: { display: "grid", gap: 8, margin: "12px 0" },
  actions: { display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginTop: 10 },
  primary: { minHeight: 46, padding: "0 20px", border: 0, borderRadius: 12, background: "#047857", color: "#fff", fontWeight: 900, fontSize: 15, cursor: "pointer" },
  secondary: { minHeight: 46, padding: "0 16px", border: "1px solid #DCD5C6", borderRadius: 12, background: "#fff", color: "#16324F", fontWeight: 800, fontSize: 14, cursor: "pointer" },
  minus: { minHeight: 46, padding: "0 18px", border: "1px solid #F0B9B3", borderRadius: 12, background: "#FFF5F3", color: "#B91C1C", fontWeight: 900, fontSize: 15, cursor: "pointer" },
  plus: { minHeight: 46, padding: "0 18px", border: "1px solid #9FD9C0", borderRadius: 12, background: "#F0FAF5", color: "#047857", fontWeight: 900, fontSize: 15, cursor: "pointer" },
  histList: { display: "grid", gap: 6, maxHeight: "52dvh", overflowY: "auto", margin: "4px 0 8px" },
  histRow: { width: "100%", font: "inherit", cursor: "pointer", display: "flex", gap: 10, alignItems: "center", padding: "10px 12px", border: "1px solid #EFEAE0", borderRadius: 10, background: "#FBFAF6" },
  histTitle: { fontWeight: 800, color: "#16324F", fontSize: 14 },
  error: { padding: "10px 12px", borderRadius: 10, background: "#FBE9E7", color: "#8A2D1C", fontSize: 13, margin: "0 0 10px" },
};
