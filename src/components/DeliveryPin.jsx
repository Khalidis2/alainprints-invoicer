import { useState } from "react";

const MAPS_URL = /https:\/\/www\.google\.com\/maps\?q=(-?\d+\.\d+),(-?\d+\.\d+)/;

// Coordinates from the pin saved in an order's notes, or null for orders placed without one.
export function pinFromNotes(notes) {
  const match = String(notes || "").match(MAPS_URL);
  return match ? { lat: Number(match[1]), lng: Number(match[2]) } : null;
}

export const stripPinFromNotes = (notes) =>
  String(notes || "").replace(MAPS_URL, "").replace(/\s*\|?\s*Location pin:\s*/g, " ").replace(/\s*\|\s*$/, "").trim();

// Plain text with everything a courier form asks for (name, phone, address, coordinates, items, amount to collect).
export function shipmentText({ reference, name, mobile, emirate, address, pin, items = [], total, paid }) {
  const lines = [
    `Order: ${reference}`,
    `Customer: ${name}`,
    `Mobile: ${mobile}`,
    `Country: UAE`,
    `City / Emirate: ${emirate}`,
    `Address: ${address}`,
    pin ? `Coordinates: ${pin.lat.toFixed(6)}, ${pin.lng.toFixed(6)}` : "Coordinates: not shared",
    pin ? `Map: https://www.google.com/maps?q=${pin.lat.toFixed(6)},${pin.lng.toFixed(6)}` : "",
    `Items: ${items.join("; ")}`,
    paid ? "Cash to collect: AED 0 (already paid by card)" : `Cash to collect: AED ${Number(total).toFixed(2)}`,
  ];
  return lines.filter(Boolean).join("\n");
}

// Everything needed to find the customer: a map with the pin, one-tap directions, and a way to hand the spot to a driver.
// Orders without a pin get a map search for the typed address instead.
export default function DeliveryPin({ pin, address, emirate, name, shipment }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedShipment, setCopiedShipment] = useState(false);

  const copyShipment = async () => {
    try {
      await navigator.clipboard.writeText(shipment);
      setCopiedShipment(true);
      window.setTimeout(() => setCopiedShipment(false), 1800);
    } catch {
      window.prompt("Copy the delivery details:", shipment);
    }
  };
  const shipmentButton = shipment ? <button type="button" style={s.btn} onClick={copyShipment}>{copiedShipment ? "Copied ✓" : "📦 Copy details for Oto"}</button> : null;

  if (!pin) {
    const query = [address, emirate, "UAE"].filter(Boolean).join(", ");
    if (!query) return null;
    return (
      <div style={s.box}>
        <div style={s.hint}>No pin shared. Showing the typed address on the map:</div>
        <a style={s.primary} href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`} target="_blank" rel="noreferrer">🔎 Find address on Google Maps</a>
        {shipmentButton}
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
        {shipmentButton}
      </div>
      {open && (
        <iframe title="Delivery location map" src={embed} loading="lazy" style={s.map} referrerPolicy="no-referrer" />
      )}
    </div>
  );
}

const s = {
  box: { display: "grid", gap: 8, marginTop: 10, padding: 10, border: "1px solid #A7D7C5", borderRadius: 10, background: "#F0FDF7" },
  hint: { color: "#6B6355", fontSize: 12.5 },
  primary: { display: "flex", alignItems: "center", justifyContent: "center", minHeight: 46, borderRadius: 9, background: "#047857", color: "#fff", fontWeight: 800, fontSize: 14, textDecoration: "none" },
  row: { display: "flex", flexWrap: "wrap", gap: 6 },
  btn: { display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "1 1 auto", minHeight: 42, padding: "0 12px", border: "1px solid #16324F", borderRadius: 8, background: "#fff", color: "#16324F", fontWeight: 800, fontSize: 13, textDecoration: "none", cursor: "pointer" },
  map: { width: "100%", height: 230, border: "1px solid #DCD5C6", borderRadius: 9, background: "#fff" },
};
