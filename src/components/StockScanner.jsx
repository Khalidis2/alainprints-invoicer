import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AED } from "../lib/helpers";
import { AddFilamentModal, EditFilamentModal } from "./StockEditor";
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

export default function StockScanner({ filaments, onUpdate, onArchive, onAdd, onClose, showToast }) {
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
  const [detail, setDetail] = useState("");
  const [torchOk, setTorchOk] = useState(false); // the phone lets web pages switch the flash on
  const [torchOn, setTorchOn] = useState(false);
  const [liveNote, setLiveNote] = useState("");
  const liveRef = useRef({ timer: null, tries: 0, busy: false, seenCode: "" });
  const [adjusting, setAdjusting] = useState(false);
  const [adding, setAdding] = useState(null); // { material, color } while the "new filament" form is open

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
    setTorchOn(false);
    setTorchOk(false);
    clearInterval(liveRef.current.timer);
    liveRef.current.timer = null;
    try { controlsRef.current?.stop(); } catch { /* already stopped */ }
    controlsRef.current = null;
    const stream = videoRef.current?.srcObject;
    if (stream && stream.getTracks) stream.getTracks().forEach((track) => track.stop());
  }, []);
  useEffect(() => stopCamera, [stopCamera]);

  const reset = () => {
    stopCamera();
    setError(""); setDetail(""); setLiveNote(""); setCode(""); setTarget(null); setRead(null); setTyped(""); setChoosing(false);
    setPickMaterial(""); setPickColor(""); setPreview(""); setSource("");
    loggedRef.current = false;
    setPhase("choose");
  };

  // ---------- AI reading (still photo or live camera) ----------
  const applyAiResult = (result, seenCode = "") => {
    loggedRef.current = false;
    setSource("photo");
    setRead(result);
    const found = clean(result.code) || seenCode;
    setCode(found);
    const learned = found ? codes[found] : null;
    if (result.matched && result.confidence >= 0.55) {
      setTarget({ material: result.material, color: result.color });
      // A barcode seen next to the text is linked to this filament, so the next scan is instant.
      if (found && !codes[found]) saveScanCode(found, { material: result.material, color: result.color }).then(setCodes).catch(() => { /* optional */ });
    } else if (learned && !(result.confidence >= 0.7 && (result.material || result.color))) setTarget(learned); // a sure AI read that is not in stock beats an old link: it is probably a new filament
    else {
      setTarget(null);
      if (materials.includes(result.material)) setPickMaterial(result.material);
      const guess = options.find((option) => option.material === result.material && norm(option.color) === norm(result.color));
      if (guess) setPickColor(guess.color);
    }
    setPhase("result");
  };

  const onPhoto = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(""); setDetail("");
    setPreview(URL.createObjectURL(file));
    setPhase("reading");
    try {
      applyAiResult(await readLabelPhoto(file, options, codes));
    } catch (cause) {
      setError(cause?.message || "The AI could not read that photo.");
      setDetail(cause?.detail || "");
      setPhase("result");
    }
  };

  // ---------- live camera: reads the label by itself, no button needed ----------
  const frameBlob = (video) => new Promise((resolve) => {
    const scale = Math.min(1, 1100 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(resolve, "image/jpeg", 0.85);
  });

  const MAX_TRIES = 8;
  const liveTick = async () => {
    const live = liveRef.current;
    const video = videoRef.current;
    if (live.busy || foundRef.current || !video || !video.videoWidth) return;
    live.busy = true;
    live.tries += 1;
    setLiveNote(`Reading the label… (${live.tries}/${MAX_TRIES})`);
    let finished = false;
    try {
      const blob = await frameBlob(video);
      const result = await readLabelPhoto(blob, options, codes);
      if (foundRef.current) return;
      // A filament that is not in stock: two reads in a row that agree and are confident mean it is new, so stop and offer to add it.
      const readKey = !result.matched && result.confidence >= 0.7 && result.material && result.color ? norm(`${result.material} ${result.color}`) : "";
      const agreed = Boolean(readKey) && live.lastNew === readKey;
      live.lastNew = readKey;
      if ((result.matched && result.confidence >= 0.7) || agreed) {
        foundRef.current = true;
        finished = true;
        stopCamera();
        setPreview(URL.createObjectURL(blob));
        applyAiResult(result, live.seenCode);
        return;
      }
      setLiveNote(result.text ? `I see "${result.text}". Hold steady, closer to the label…` : "Can't see a label yet. Move closer and hold steady…");
    } catch (cause) {
      // A bad key, a limit or a sign-out will not fix itself: stop and show why.
      if (!foundRef.current) {
        foundRef.current = true;
        finished = true;
        stopCamera();
        setError(cause?.message || "The AI could not read the label.");
        setDetail(cause?.detail || "");
        setPhase("result");
      }
    } finally {
      live.busy = false;
    }
    if (!finished && live.tries >= MAX_TRIES && !foundRef.current) {
      foundRef.current = true;
      stopCamera();
      if (live.seenCode) { setCode(live.seenCode); setRead(null); loggedRef.current = false; setSource("barcode"); setPhase("result"); return; }
      setPhase("choose");
      setError("I couldn't read that label. Try again closer, take a still photo, or type the code.");
    }
  };

  // ---------- barcode / QR (also runs during the live camera) ----------
  // force = true when the code was typed or is the last resort; otherwise only labels already linked finish instantly.
  const handleCode = useCallback((raw, force = true) => {
    const value = clean(raw);
    if (!value) return;
    const isKnown = Boolean(codes[value]) || filaments.some((entry) => clean(entry.sku) === value);
    if (!force && !isKnown) { liveRef.current.seenCode = value; return; } // unknown: let the AI read the text, then link this code
    foundRef.current = true;
    loggedRef.current = false;
    setSource("barcode");
    stopCamera();
    try { navigator.vibrate?.(80); } catch { /* optional */ }
    setCode(value);
    setRead(null);
    setChoosing(false);
    setPhase("result");
  }, [stopCamera, codes, filaments]);

  const startCamera = useCallback(async () => {
    setError(""); setDetail(""); setLiveNote("");
    foundRef.current = false;
    liveRef.current = { timer: null, tries: 0, busy: false, seenCode: "" };
    setPhase("starting");
    try {
      // The barcode library is only downloaded when you use the live camera.
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 200 });
      const controls = await reader.decodeFromConstraints({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } }, videoRef.current, (result) => {
        if (result) handleCode(result.getText(), false);
      });
      controlsRef.current = controls;
      if (foundRef.current) { controls.stop(); return; }
      try { setTorchOk(Boolean(videoRef.current?.srcObject?.getVideoTracks?.()[0]?.getCapabilities?.().torch)); } catch { setTorchOk(false); }
      setPhase("scanning");
      setLiveNote("Point the camera at the label…");
      liveRef.current.timer = setInterval(liveTick, 2600);
      setTimeout(liveTick, 1200);
    } catch (cause) {
      setPhase("choose");
      setError(cause?.name === "NotAllowedError" ? "Camera is blocked. Allow the camera for this site in your browser settings." : "Couldn't start the camera.");
    }
    // liveTick reads the latest state through refs and closures created per render, so it is restarted with a fresh copy on every start
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleCode, options, codes]);

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

  // A filament that is not in stock yet: the form opens filled in from the label, and the label code is remembered.
  const addNew = (prefill) => setAdding({ material: prefill?.material || "", color: prefill?.color || "" });
  const saveNew = async (filament) => {
    await onAdd(filament);
    const chosen = { material: filament.material, color: filament.color.trim() };
    loggedRef.current = false;
    setTarget(chosen);
    setChoosing(false);
    if (code) saveScanCode(code, chosen).then(setCodes).catch(() => { /* optional */ });
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

  // The phone's flash, to light up the label. Android Chrome supports it; iPhone Safari does not let web pages use it.
  const toggleTorch = async () => {
    const track = videoRef.current?.srcObject?.getVideoTracks?.()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch {
      setTorchOk(false);
      showToast?.("This phone won't let the page use the flash.");
    }
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

        {error && <div style={s.error}>{error}{detail ? <div style={{ fontSize: 11, opacity: 0.75, marginTop: 4, wordBreak: "break-word" }}>{detail}</div> : null}</div>}

        {phase === "choose" && (
          <div style={s.body}>
            <button type="button" style={s.bigBtn} onClick={startCamera}>🎥 Live scan: point at the label</button>
            <div style={s.meta}>The AI reads the label by itself and shows how many you have. Barcodes you scanned before are recognised instantly.</div>
            <button type="button" style={s.secondary} onClick={() => fileRef.current?.click()}>📷 Take a still photo</button>
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
          <div style={s.hint}>{phase === "starting" ? "Starting camera…" : liveNote || "Point the camera at the label"}</div>
        </div>
        {(phase === "starting" || phase === "scanning") && <div style={s.actions}>{phase === "scanning" && <button type="button" style={s.primary} onClick={liveTick}>📸 Read now</button>}{phase === "scanning" && torchOk && <button type="button" style={torchOn ? s.torchOn : s.secondary} onClick={toggleTorch} aria-pressed={torchOn}>🔦 Flash {torchOn ? "on" : "off"}</button>}<button type="button" style={s.secondary} onClick={reset}>Back</button></div>}

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
                {onAdd && <button type="button" style={s.newBtn} onClick={() => addNew(read)}>➕ New filament, not in my stock{read?.material || read?.color ? `: ${[read.material, read.color].filter(Boolean).join(" · ")}` : ""}</button>}
              </>
            )}
            <div style={s.actions}>
              <button type="button" style={s.primary} onClick={reset}>📷 Scan next</button>
              {known && !choosing && <button type="button" style={s.secondary} onClick={() => (code && (linked || read) ? forget() : setChoosing(true))}>Wrong filament?</button>}
              {known && !choosing && onAdd && <button type="button" style={s.secondary} onClick={() => addNew(read && !read.matched ? read : null)}>➕ New filament</button>}
              <button type="button" style={s.secondary} onClick={close}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
    {adding && onAdd && <AddFilamentModal filaments={filaments} initial={adding} onSave={saveNew} onClose={() => setAdding(null)} showToast={showToast || (() => {})} />}
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
  torchOn: { minHeight: 46, padding: "0 16px", border: "1px solid #F5C451", borderRadius: 12, background: "#FFF6D6", color: "#8A5A00", fontWeight: 900, fontSize: 14, cursor: "pointer" },
  minus: { minHeight: 46, padding: "0 18px", border: "1px solid #F0B9B3", borderRadius: 12, background: "#FFF5F3", color: "#B91C1C", fontWeight: 900, fontSize: 15, cursor: "pointer" },
  plus: { minHeight: 46, padding: "0 18px", border: "1px solid #9FD9C0", borderRadius: 12, background: "#F0FAF5", color: "#047857", fontWeight: 900, fontSize: 15, cursor: "pointer" },
  histList: { display: "grid", gap: 6, maxHeight: "52dvh", overflowY: "auto", margin: "4px 0 8px" },
  histRow: { width: "100%", font: "inherit", cursor: "pointer", display: "flex", gap: 10, alignItems: "center", padding: "10px 12px", border: "1px solid #EFEAE0", borderRadius: 10, background: "#FBFAF6" },
  histTitle: { fontWeight: 800, color: "#16324F", fontSize: 14 },
  newBtn: { width: "100%", minHeight: 46, border: "1px dashed #9FD9C0", borderRadius: 12, background: "#F0FAF5", color: "#047857", fontWeight: 900, fontSize: 14, cursor: "pointer", padding: "8px 12px" },
  error: { padding: "10px 12px", borderRadius: 10, background: "#FBE9E7", color: "#8A2D1C", fontSize: 13, margin: "0 0 10px" },
};
