import { useMemo, useState } from "react";
import { AED } from "../lib/helpers";

const SITE = "printtools3d.com/store";
const BRAND = "Alain Prints";
const PHONE = "+971 52 244 4690";
const DELIVERY = "Delivery across the UAE: AED 20, free on orders of AED 500 or more.";

const num = (value) => {
  const n = Number(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
};

// Every filament type with its price. Colours in stock are listed so a customer sees what is available now.
function buildTypes(filaments) {
  const types = new Map();
  for (const entry of filaments) {
    if (entry.material === "Payment Test") continue;
    const price = Number(entry.sellingPrice || 0);
    const spools = entry.stockStatus === "available" ? Math.floor(Number(entry.remainingG || 0) / Number(entry.spoolWeightG || 1000)) : 0;
    const color = String(entry.color || "").trim();
    if (!types.has(entry.material)) types.set(entry.material, { type: entry.material, prices: new Set(), colours: new Map() });
    const group = types.get(entry.material);
    if (price > 0) group.prices.add(price);
    const current = group.colours.get(color.toLowerCase()) || { color, spools: 0, price: 0 };
    current.spools += spools;
    current.price = current.price || price;
    group.colours.set(color.toLowerCase(), current);
  }
  return [...types.values()]
    .map((group) => {
      const prices = [...group.prices].sort((a, b) => a - b);
      const colours = [...group.colours.values()].sort((a, b) => a.color.localeCompare(b.color));
      return { type: group.type, min: prices[0] || 0, max: prices[prices.length - 1] || 0, colours, inStock: colours.filter((colour) => colour.spools > 0) };
    })
    .sort((a, b) => a.type.localeCompare(b.type));
}

const priceLabel = (group) => (!group.min ? "price on request" : group.min === group.max ? `AED ${num(group.min)}` : `AED ${num(group.min)} - ${num(group.max)}`);

function typeLines(group, withColours) {
  const lines = [`*${group.type}* - ${priceLabel(group)}`];
  if (withColours) {
    if (group.inStock.length) lines.push(`In stock: ${group.inStock.map((colour) => colour.color).join(", ")}`);
    else lines.push("Out of stock right now");
  }
  return lines;
}

function filamentText(types, withColours) {
  const lines = [`*Filament price list - ${BRAND}*`, "_Price per 1 kg spool, 1.75 mm_", ""];
  for (const group of types) {
    lines.push(...typeLines(group, withColours));
    if (withColours) lines.push("");
  }
  if (!withColours) lines.push("");
  lines.push(DELIVERY, `Order online: ${SITE} · WhatsApp ${PHONE}`);
  return lines.join("\n");
}

function productsText(items) {
  const lines = [`*3D printed products - ${BRAND}*`, "_Choose your filament colour · prices in AED_", ""];
  for (const item of items) lines.push(`• ${item.name} - AED ${num(item.price)}`);
  lines.push("", `Order on WhatsApp ${PHONE} · printtools3d.com/products`);
  return lines.join("\n");
}

export default function PriceList({ filaments, items, showToast }) {
  const [withColours, setWithColours] = useState(false);
  const [onlyPublished, setOnlyPublished] = useState(false);
  const types = useMemo(() => buildTypes(filaments), [filaments]);
  const products = useMemo(
    () => items.filter((item) => Number(item.price) > 0 && (!onlyPublished || item.publicVisible)).sort((a, b) => a.name.localeCompare(b.name)),
    [items, onlyPublished],
  );

  const copy = async (text, done) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(done);
    } catch {
      window.prompt("Copy this:", text);
    }
  };
  const whatsapp = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;

  const filamentAll = filamentText(types, withColours);
  const productsAll = productsText(products);
  const everything = `${filamentAll}\n\n${productsAll}`;

  return (
    <section>
      <div style={s.heading}>
        <h2 style={s.title}>Price list</h2>
        <p style={s.sub}>Copy a price list to paste into WhatsApp when a customer asks. It always uses your current prices and stock.</p>
      </div>

      <div style={s.bar}>
        <button type="button" style={s.primary} onClick={() => copy(everything, "Full price list copied")}>📋 Copy everything</button>
        <a style={s.secondary} href={whatsapp(everything)} target="_blank" rel="noreferrer">Send on WhatsApp</a>
      </div>
      <div style={s.options}>
        <label style={s.opt}><input type="checkbox" checked={withColours} onChange={(event) => setWithColours(event.target.checked)} /> Also list the colours in stock</label>
        <label style={s.opt}><input type="checkbox" checked={onlyPublished} onChange={(event) => setOnlyPublished(event.target.checked)} /> Only products published on the website</label>
      </div>

      <div style={s.panel}>
        <div style={s.panelHead}>
          <h3 style={s.h3}>Filament</h3>
          <div style={s.row}>
            <button type="button" style={s.btn} onClick={() => copy(filamentAll, "Filament prices copied")}>Copy filament list</button>
            <a style={s.btn} href={whatsapp(filamentAll)} target="_blank" rel="noreferrer">WhatsApp</a>
          </div>
        </div>
        {types.length === 0 && <p style={s.empty}>No filament added yet.</p>}
        {types.map((group) => (
          <div key={group.type} style={s.item}>
            <div style={{ minWidth: 0 }}>
              <strong>{group.type}</strong>
              {!group.inStock.length && <div style={s.meta}>Out of stock right now</div>}
            </div>
            <div style={s.right}>
              <b style={{ color: group.min ? "#16324F" : "#B45309" }}>{group.min ? `${priceLabel(group)} / spool` : "No price"}</b>
              <button type="button" style={s.copy} onClick={() => copy(typeLines(group, withColours).join("\n"), `${group.type} copied`)}>Copy</button>
            </div>
          </div>
        ))}
      </div>

      <div style={s.panel}>
        <div style={s.panelHead}>
          <h3 style={s.h3}>3D printed products</h3>
          <div style={s.row}>
            <button type="button" style={s.btn} onClick={() => copy(productsAll, "Product prices copied")} disabled={!products.length}>Copy product list</button>
            <a style={s.btn} href={whatsapp(productsAll)} target="_blank" rel="noreferrer">WhatsApp</a>
          </div>
        </div>
        {products.length === 0 && <p style={s.empty}>No products with a price yet.</p>}
        {products.map((item) => (
          <div key={item.id} style={s.item}>
            <div style={{ minWidth: 0 }}>
              <strong>{item.name}</strong>
              <div style={s.meta}>{item.category}{item.publicVisible ? " · on website" : " · not on website"}</div>
            </div>
            <div style={s.right}>
              <b style={{ color: "#16324F" }}>{AED(item.price)}</b>
              <button type="button" style={s.copy} onClick={() => copy(`${item.name} - AED ${num(item.price)}`, `${item.name} copied`)}>Copy</button>
            </div>
          </div>
        ))}
      </div>

      <div style={s.preview}>
        <strong style={{ color: "#16324F" }}>Preview of "Copy everything"</strong>
        <pre style={s.pre}>{everything}</pre>
      </div>
    </section>
  );
}

const s = {
  heading: { marginBottom: 14 },
  title: { margin: 0, fontSize: 24 },
  sub: { margin: "5px 0 0", color: "#8A7F6D", fontSize: 13, lineHeight: 1.5 },
  bar: { display: "flex", flexWrap: "wrap", gap: 8, margin: "0 0 10px" },
  primary: { flex: "1 1 220px", minHeight: 50, border: 0, borderRadius: 10, background: "#16324F", color: "#fff", fontWeight: 800, fontSize: 15, cursor: "pointer" },
  secondary: { flex: "1 1 160px", display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 50, borderRadius: 10, background: "#25D366", color: "#073B1C", fontWeight: 800, textDecoration: "none" },
  options: { display: "flex", flexWrap: "wrap", gap: 14, margin: "0 0 14px", color: "#6B6355", fontSize: 13 },
  opt: { display: "flex", alignItems: "center", gap: 7, minHeight: 32 },
  panel: { margin: "0 0 14px", padding: 14, border: "1px solid #E4DFD3", borderRadius: 12, background: "#fff" },
  panelHead: { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 },
  h3: { margin: 0, fontSize: 17, color: "#16324F" },
  row: { display: "flex", gap: 6, flexWrap: "wrap" },
  btn: { display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 42, padding: "0 12px", border: "1px solid #16324F", borderRadius: 8, background: "#fff", color: "#16324F", fontWeight: 800, fontSize: 13, textDecoration: "none", cursor: "pointer" },
  item: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "1px solid #EFEAE0" },
  meta: { marginTop: 2, color: "#8A7F6D", fontSize: 12, lineHeight: 1.4 },
  right: { display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" },
  copy: { minWidth: 62, minHeight: 40, border: "1px solid #16324F", borderRadius: 8, background: "#fff", color: "#16324F", fontWeight: 800, cursor: "pointer" },
  empty: { color: "#8A7F6D", fontSize: 13 },
  preview: { padding: 14, border: "1px dashed #DCD5C6", borderRadius: 12, background: "#FFFDF8" },
  pre: { margin: "8px 0 0", whiteSpace: "pre-wrap", wordBreak: "break-word", font: "13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace", color: "#3F3A30" },
};
