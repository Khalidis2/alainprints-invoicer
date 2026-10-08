import { useState } from "react";

const MAPS_URL = /https:\/\/www\.google\.com\/maps\?q=(-?\d+\.\d+),(-?\d+\.\d+)/;

// Coordinates from the pin saved in an order's notes, or null for orders placed without one.
export function pinFromNotes(notes) {
  const match = String(notes || "").match(MAPS_URL);
  return match ? { lat: Number(match[1]), lng: Number(match[2]) } : null;
}

export const stripPinFromNotes = (notes) =>
  String(notes || "").replace(MAPS_URL, "").replace(/\s*\|?\s*Location pin:\s*/g, " ").replace(/\s*\|\s*$/, "").trim();

// UAE mobile in the two shapes courier forms ask for: +9715XXXXXXXX and 05XXXXXXXX.
function phoneForms(raw) {
  const digits = String(raw || "").replace(/[^\d]/g, "");
  const national = digits.replace(/^(00)?971/, "").replace(/^0/, "");
  return { international: national ? `+971${national}` : "", local: national ? `0${national}` : "", digits971: national ? `971${national}` : "" };
}

const emailFromNotes = (notes) => (String(notes || "").match(/Email:\s*([^\s|]+@[^\s|]+)/i) || [])[1] || "";
const noteWithoutExtras = (notes) => stripPinFromNotes(String(notes || "").replace(/\s*\|?\s*Email:\s*[^\s|]+@[^\s|]+/i, "")).replace(/^\s*\|\s*|\s*\|\s*$/g, "").trim();

// One entry per field a courier form usually has, so each can be copied on its own.
export function shipFields({ reference, name, mobile, notes, emirate, address, pin, items = [], quantity = 0, total, paid }) {
  const phone = phoneForms(mobile);
  const weight = Math.max(1, Math.round(quantity * 1.1 * 10) / 10);
  const fields = [
    ["Order reference", reference],
    ["Customer name", name],
    ["Mobile (+971)", phone.international || mobile],
    ["Mobile (05…)", phone.local],
    ["Email", emailFromNotes(notes)],
    ["Country", "United Arab Emirates (UAE)"],
    ["City / Emirate", emirate],
    ["Address", address],
    ["Delivery note", noteWithoutExtras(notes)],
    ["Latitude", pin ? pin.lat.toFixed(6) : ""],
    ["Longitude", pin ? pin.lng.toFixed(6) : ""],
    ["Map link", pin ? `https://www.google.com/maps?q=${pin.lat.toFixed(6)},${pin.lng.toFixed(6)}` : ""],
    ["Payment type", paid ? "Prepaid (paid by card)" : "Cash on delivery"],
    ["Cash to collect (AED)", paid ? "0" : Number(total).toFixed(2)],
    ["Items / description", items.join("; ")],
    ["Packages", "1"],
    ["Approx. weight (kg)", `${weight}`],
  ];
  return fields.filter(([, value]) => value !== "" && value != null).map(([label, value]) => ({ label, value: String(value) }));
}

function ShipPanel({ ship }) {
  const [open, setOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState("");
  const fields = shipFields(ship);

  const copy = async (key, value) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(""), 1500);
    } catch {
      window.prompt("Copy this:", value);
    }
  };
  const all = fields.map((field) => `${field.label}: ${field.value}`).join("\n");

  return (
    <div style={s.ship}>
      <button type="button" style={s.shipToggle} onClick={() => setOpen(!open)}>{open ? "Hide Oto details" : "📦 Ship with Oto: copy each field"}</button>
      {open && (
        <div style={s.shipBody}>
          <button type="button" style={s.btn} onClick={() => copy("__all", all)}>{copiedKey === "__all" ? "Copied all ✓" : "Copy everything"}</button>
          {fields.map((field) => (
            <div key={field.label} style={s.field}>
              <div style={{ minWidth: 0 }}>
                <small style={s.fieldLabel}>{field.label}</small>
                <div style={s.fieldValue}>{field.value}</div>
              </div>
              <button type="button" style={s.copyBtn} onClick={() => copy(field.label, field.value)}>{copiedKey === field.label ? "✓" : "Copy"}</button>
            </div>
          ))}
          <a style={s.btn} href="https://www.tryoto.com/" target="_blank" rel="noreferrer">Open Oto ↗</a>
        </div>
      )}
    </div>
  );
}

// Everything needed to find the customer: a map with the pin, one-tap directions, and a way to hand the spot to a driver.
// Orders without a pin get a map search for the typed address instead.
export default function DeliveryPin({ pin, address, emirate, name, ship }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const shipPanel = ship ? <ShipPanel ship={ship} /> : null;

  if (!pin) {
    const query = [address, emirate, "UAE"].filter(Boolean).join(", ");
    if (!query) return null;
    return (
      <div style={s.box}>
        <div style={s.hint}>No pin shared. Showing the typed address on the map:</div>
        <a style={s.primary} href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`} target="_blank" rel="noreferrer">🔎 Find address on Google Maps</a>
        {shipPanel}
      </div>
    );
  }

  const coords = `${pin.lat.toFixed(6)},${pin.lng.toFixed(6)}`;
  const view = `https://www.google.com/maps?q=${coords}`;
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${coords}&travelmode=driving`;
  const waze = `https://waze.com/ul?ll=${coords}&navigate=yes`;
  const delta = 0.004;
  const embed = `https://www.openstreetmap.org/export/embed.html?bbox=${pin.lng - delta},${pin.lat - delta},${pin.lng + delta},${pin.lat + delta}&layer=mapnik&marker=${coords}`;
  const toDriver = `https://wa.me/?text=${encodeURIComponent(`Delivery${name ? ` for ${name}` : ""}: ${view}`)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(view);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Copy this location link:", view);
    }
  };

  return (
    <div style={s.box}>
      <a style={s.primary} href={directions} target="_blank" rel="noreferrer">📍 Navigate to the customer</a>
      <div style={s.row}>
        <button type="button" style={s.btn} onClick={() => setOpen(!open)}>{open ? "Hide map" : "Show map"}</button>
        <a style={s.btn} href={view} target="_blank" rel="noreferrer">Google Maps</a>
        <a style={s.btn} href={waze} target="_blank" rel="noreferrer">Waze</a>
      </div>
      <div style={s.row}>
        <button type="button" style={s.btn} onClick={copy}>{copied ? "Copied ✓" : "Copy location link"}</button>
        <a style={s.btn} href={toDriver} target="_blank" rel="noreferrer">Send to driver (WhatsApp)</a>
      </div>
      {shipPanel}
      {open && (
        <iframe title="Delivery location map" src={embed} loading="lazy" style={s.map} referrerPolicy="no-referrer" />
      )}
    </div>
  );
}

const s = {
  ship: { display: "grid", gap: 8 },
  shipToggle: { minHeight: 46, border: "1.5px solid #16324F", borderRadius: 9, background: "#16324F", color: "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer" },
  shipBody: { display: "grid", gap: 6, padding: 10, border: "1px solid #DCD5C6", borderRadius: 9, background: "#fff" },
  field: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid #EFEAE0" },
  fieldLabel: { display: "block", color: "#8A7F6D", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em" },
  fieldValue: { color: "#1B2A3D", fontSize: 14, lineHeight: 1.35, overflowWrap: "anywhere" },
  copyBtn: { flex: "0 0 auto", minWidth: 64, minHeight: 40, border: "1px solid #16324F", borderRadius: 8, background: "#fff", color: "#16324F", fontWeight: 800, cursor: "pointer" },
  box: { display: "grid", gap: 8, marginTop: 10, padding: 10, border: "1px solid #A7D7C5", borderRadius: 10, background: "#F0FDF7" },
  hint: { color: "#6B6355", fontSize: 12.5 },
  primary: { display: "flex", alignItems: "center", justifyContent: "center", minHeight: 46, borderRadius: 9, background: "#047857", color: "#fff", fontWeight: 800, fontSize: 14, textDecoration: "none" },
  row: { display: "flex", flexWrap: "wrap", gap: 6 },
  btn: { display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "1 1 auto", minHeight: 42, padding: "0 12px", border: "1px solid #16324F", borderRadius: 8, background: "#fff", color: "#16324F", fontWeight: 800, fontSize: 13, textDecoration: "none", cursor: "pointer" },
  map: { width: "100%", height: 230, border: "1px solid #DCD5C6", borderRadius: 9, background: "#fff" },
};
