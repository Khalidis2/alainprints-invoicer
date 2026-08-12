import { useState } from "react";
import { AED, CATEGORIES, CAT_STYLE } from "../lib/helpers";
import { uploadItemImage } from "../lib/storage";

export default function ItemsMenu({ items, onAdd, onUpdate, onDelete, showToast }) {
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState("All");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sharingId, setSharingId] = useState(null);
  const [translating, setTranslating] = useState(false);

  const startNew = () => {
    setEditing({ id: null, name: "", nameAr: "", category: "3D Print", price: "", description: "", imageUrl: null });
    setShowForm(true);
  };
  const startEdit = (item) => {
    setEditing({ ...item });
    setShowForm(true);
  };
  const handleImagePick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadItemImage(file);
      setEditing((prev) => ({ ...prev, imageUrl: url }));
    } catch (err) {
      showToast("Image upload failed — check connection");
    } finally {
      setUploading(false);
    }
  };
  const translateName = async () => {
    const text = editing.name.trim();
    if (!text) return;
    setTranslating(true);
    try {
      const translated = await translateToArabic(text);
      setEditing((prev) => ({ ...prev, nameAr: translated }));
    } catch (err) {
      showToast("Couldn't auto-translate — type it manually instead");
    } finally {
      setTranslating(false);
    }
  };
  const translateNameOnBlur = async () => {
    if (!editing.name.trim() || editing.nameAr?.trim() || translating) return;
    await translateName();
  };
  const shareItem = async (item) => {
    const caption = `${item.name} — ${AED(item.price)}${item.description ? `\n${item.description}` : ""}\nDM @_alainprints to order`;
    const safeName = item.name.replace(/[^\w-]+/g, "_") || "item";
    setSharingId(item.id);
    try {
      let cardItem = item;
      if (!item.nameAr?.trim()) {
        try {
          cardItem = { ...item, nameAr: await translateToArabic(item.name) };
        } catch (translationError) {
          showToast("Couldn't translate the Arabic name — try sharing again");
          return;
        }
      }
      if (item.imageUrl) {
        try {
          const res = await fetch(item.imageUrl);
          const sourceBlob = await res.blob();
          const cardBlob = await composeShareCard(cardItem, sourceBlob);
          const file = new File([cardBlob], `${safeName}.jpg`, { type: "image/jpeg" });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: item.name, text: caption });
            return;
          }
          const dlUrl = URL.createObjectURL(cardBlob);
          const a = document.createElement("a");
          a.href = dlUrl;
          a.download = `${safeName}.jpg`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(dlUrl);
          await navigator.clipboard.writeText(caption);
          showToast("Share image downloaded & caption copied");
          return;
        } catch (composeErr) {
          // couldn't fetch/compose the image — fall through to a link/text share
        }
      }
      if (navigator.share) {
        await navigator.share({ title: item.name, text: caption, url: item.imageUrl || undefined });
        return;
      }
      await navigator.clipboard.writeText(item.imageUrl ? `${caption}\n${item.imageUrl}` : caption);
      showToast("Sharing isn't supported here — caption copied instead");
    } catch (err) {
      if (err.name !== "AbortError") showToast("Couldn't share — try again");
    } finally {
      setSharingId(null);
    }
  };
  const remove = async (id) => {
    try {
      await onDelete(id);
      showToast("Item removed");
    } catch (e) {
      showToast("Couldn't remove item — check connection");
    }
  };
  const save = async () => {
    if (!editing.name.trim() || editing.price === "") return;
    setSaving(true);
    try {
      if (editing.id) {
        await onUpdate({ ...editing, price: Number(editing.price) });
        showToast("Item updated");
      } else {
        await onAdd({ ...editing, price: Number(editing.price) });
        showToast("Item added");
      }
      setShowForm(false);
      setEditing(null);
    } catch (e) {
      const missingColumn = /name_ar|image_url|schema cache|column/i.test(e.message || "");
      showToast(missingColumn ? "Database update required — add name_ar and image_url columns" : `Couldn't save item — ${e.message || "check connection"}`);
    } finally {
      setSaving(false);
    }
  };

  const filtered = filter === "All" ? items : items.filter((i) => i.category === filter);

  return (
    <div>
      <div style={s.head}>
        <div>
          <h2 style={s.h2}>Items menu</h2>
          <div style={s.sub}>{items.length} item{items.length !== 1 ? "s" : ""} · prices in AED</div>
        </div>
        <button style={s.primaryBtn} onClick={startNew}>
          + Add item
        </button>
      </div>

      <div style={s.filterRow}>
        {["All", ...CATEGORIES].map((c) => (
          <button
            key={c}
            onClick={() => setFilter(c)}
            style={{ ...s.chip, ...(filter === c ? s.chipActive : {}) }}
          >
            {c}
          </button>
        ))}
      </div>

      {filtered.length === 0 && <div style={s.empty}>No items in this category yet.</div>}

      <div style={s.grid}>
        {filtered.map((item) => {
          const cs = CAT_STYLE[item.category] || CAT_STYLE.Custom;
          return (
            <div key={item.id} style={s.card}>
              {item.imageUrl && <img src={item.imageUrl} alt={item.name} style={s.thumb} />}
              <div style={s.cardTop}>
                <span style={{ ...s.badge, color: cs.fg, background: cs.bg }}>{item.category}</span>
                <span style={s.price}>{AED(item.price)}</span>
              </div>
              <div style={s.name}>{item.name}</div>
              {item.nameAr && <div style={s.nameAr}>{item.nameAr}</div>}
              <div style={s.desc}>{item.description}</div>
              <div style={s.actions}>
                <button
                  style={{ ...s.link, color: "#E8792D", opacity: sharingId === item.id ? 0.6 : 1 }}
                  onClick={() => shareItem(item)}
                  disabled={sharingId === item.id}
                >
                  {sharingId === item.id ? "Sharing…" : "Share"}
                </button>
                <button style={s.link} onClick={() => startEdit(item)}>
                  Edit
                </button>
                <button style={{ ...s.link, color: "#B3451D" }} onClick={() => remove(item.id)}>
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {showForm && (
        <div style={s.overlay} onClick={() => setShowForm(false)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <div style={s.modalTitle}>{editing.id ? "Edit item" : "New item"}</div>

            <label style={s.label}>Photo</label>
            {editing.imageUrl && (
              <img src={editing.imageUrl} alt="" style={{ ...s.thumb, marginBottom: 8 }} />
            )}
            <input type="file" accept="image/*" onChange={handleImagePick} disabled={uploading} style={{ marginBottom: 4 }} />
            {uploading && <div style={{ fontSize: 12, color: "#8A7F6D" }}>Uploading…</div>}

            <label style={s.label}>Name</label>
            <input
              style={s.input}
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              onBlur={translateNameOnBlur}
              placeholder="e.g. Keychain — UAE Plate Style"
            />

            <div style={s.labelRow}>
              <label style={{ ...s.label, marginTop: 0 }}>Name (Arabic) — optional</label>
              <button
                type="button"
                style={{ ...s.link, opacity: translating || !editing.name.trim() ? 0.6 : 1 }}
                onClick={translateName}
                disabled={translating || !editing.name.trim()}
              >
                {translating ? "Translating…" : "Auto-translate"}
              </button>
            </div>
            <input
              style={{ ...s.input, direction: "rtl", textAlign: "right" }}
              value={editing.nameAr || ""}
              onChange={(e) => setEditing({ ...editing, nameAr: e.target.value })}
              placeholder="الاسم بالعربية"
            />

            <label style={s.label}>Category</label>
            <select
              style={s.input}
              value={editing.category}
              onChange={(e) => setEditing({ ...editing, category: e.target.value })}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <label style={s.label}>Price (AED)</label>
            <input
              style={s.input}
              type="number"
              min="0"
              step="0.01"
              value={editing.price}
              onChange={(e) => setEditing({ ...editing, price: e.target.value })}
              placeholder="0.00"
            />

            <label style={s.label}>Feature</label>
            <input
              style={s.input}
              value={editing.description}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              placeholder="e.g. Holds 2 controllers"
            />

            <div style={s.modalActions}>
              <button style={s.secondaryBtn} onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button style={s.primaryBtn} onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save item"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

async function translateToArabic(text) {
  const res = await fetch(
    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ar&dt=t&q=${encodeURIComponent(text)}`
  );
  if (!res.ok) throw new Error("translate request failed");
  const data = await res.json();
  const translated = data[0].map((chunk) => chunk[0]).join("").trim();
  if (!translated) throw new Error("empty translation");
  return translated;
}

const CARD_SIZE = 1080;
const HEAD_FONT = "'Sora', system-ui, sans-serif";
const AR_FONT_FAMILY = "'Cairo', -apple-system, system-ui, sans-serif";
const INK = "#2E2C28";
const ACCENT = "#B8D84A";

async function ensureShareFontLoaded() {
  if (!document.fonts) return;
  try {
    await Promise.all([
      document.fonts.load(`400 1em ${HEAD_FONT}`),
      document.fonts.load(`500 1em ${HEAD_FONT}`),
      document.fonts.load(`600 1em ${HEAD_FONT}`),
      document.fonts.load(`600 1em ${AR_FONT_FAMILY}`),
    ]);
  } catch (err) {
    // font failed to load — canvas will fall back to the system font
  }
}

function fitFontSize(ctx, text, weight, family, maxWidth, maxSize, minSize) {
  let size = maxSize;
  while (size > minSize) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 2;
  }
  return size;
}

function fitWrappedText(ctx, text, weight, family, maxWidth, maxLines, maxSize, minSize) {
  for (let size = maxSize; size >= minSize; size -= 2) {
    ctx.font = `${weight} ${size}px ${family}`;
    const lines = wrapText(ctx, text, maxWidth);
    if (lines.length <= maxLines) return { size, lines };
  }
  ctx.font = `${weight} ${minSize}px ${family}`;
  return { size: minSize, lines: wrapText(ctx, text, maxWidth).slice(0, maxLines) };
}

function formatArabicProductName(text) {
  return text
    .replace(/\s+x\s*(\d+)\s*$/i, " x$1")
    .replace(/\s+x(\d+)\s*$/i, (_, count) => ` \u2066x${count}\u2069`)
    .trim();
}

function formatCardPrice(value) {
  const amount = Number(value || 0);
  return `AED ${amount.toLocaleString("en-AE", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function roundedRectPath(ctx, x, y, w, h, radius) {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawImageCoverRounded(ctx, img, x, y, w, h, radius) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const drawW = img.naturalWidth * scale;
  const drawH = img.naturalHeight * scale;
  const offsetX = x - (drawW - w) / 2;
  const offsetY = y - (drawH - h) / 2;
  ctx.save();
  roundedRectPath(ctx, x, y, w, h, radius);
  ctx.clip();
  ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
  ctx.restore();
}

async function composeShareCard(item, sourceBlob) {
  const objectUrl = URL.createObjectURL(sourceBlob);
  try {
    const [img] = await Promise.all([
      new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("image failed to load"));
        el.src = objectUrl;
      }),
      ensureShareFontLoaded(),
    ]);

    const canvas = document.createElement("canvas");
    canvas.width = CARD_SIZE;
    canvas.height = CARD_SIZE;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Photo fills the entire square — poster style, no side panel.
    drawImageCoverRounded(ctx, img, 0, 0, CARD_SIZE, CARD_SIZE, 0);

    const PAD = 64;
    const contentW = CARD_SIZE - PAD * 2;
    ctx.textBaseline = "top";

    // -- measure every block first, so the scrim + text can be bottom-anchored --
    const headline = fitWrappedText(ctx, item.name.toUpperCase(), 700, HEAD_FONT, contentW, 3, 68, 40);
    const nameLineH = Math.round(headline.size * 1.14);
    let blockH = headline.lines.length * nameLineH;

    let arabicName = "";
    let arabic = null;
    let arLineH = 0;
    if (item.nameAr) {
      arabicName = formatArabicProductName(item.nameAr);
      arabic = fitWrappedText(ctx, arabicName, 600, AR_FONT_FAMILY, contentW, 2, 38, 24);
      arLineH = Math.round(arabic.size * 1.4);
      blockH += 20 + arabic.lines.length * arLineH;
    }

    let feature = null;
    let featureLineH = 0;
    let featureBoxH = 0;
    if (item.description) {
      feature = fitWrappedText(ctx, item.description.toUpperCase(), 600, HEAD_FONT, contentW - 36, 2, 24, 17);
      featureLineH = Math.round(feature.size * 1.15);
      featureBoxH = feature.lines.length * featureLineH + 28;
      blockH += 26 + featureBoxH;
    }

    const priceText = formatCardPrice(item.price);
    const priceSize = fitFontSize(ctx, priceText, 700, HEAD_FONT, contentW, 84, 44);
    const priceLineH = Math.round(priceSize * 1.1);
    blockH += 32 + priceLineH;

    const footerText = "3D PRINTED IN UAE  •  DM @_alainprints";
    const footerSize = fitFontSize(ctx, footerText, 500, HEAD_FONT, contentW, 16, 12);
    blockH += 24 + footerSize;

    // -- scrims: dark bottom wash for the text block, light top wash for the brand mark --
    const scrimTop = Math.min(CARD_SIZE * 0.45, CARD_SIZE - blockH - PAD - 40);
    const scrim = ctx.createLinearGradient(0, scrimTop, 0, CARD_SIZE);
    scrim.addColorStop(0, "rgba(15,16,12,0)");
    scrim.addColorStop(1, "rgba(15,16,12,0.82)");
    ctx.fillStyle = scrim;
    ctx.fillRect(0, scrimTop, CARD_SIZE, CARD_SIZE - scrimTop);

    const topScrim = ctx.createLinearGradient(0, 0, 0, 150);
    topScrim.addColorStop(0, "rgba(15,16,12,0.5)");
    topScrim.addColorStop(1, "rgba(15,16,12,0)");
    ctx.fillStyle = topScrim;
    ctx.fillRect(0, 0, CARD_SIZE, 150);

    // brand
    ctx.font = `600 24px ${HEAD_FONT}`;
    ctx.fillStyle = "#FAF8F4";
    if ("letterSpacing" in ctx) ctx.letterSpacing = "2px";
    ctx.fillText("ALAINPRINTS", PAD, 56);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";

    // -- draw the bottom-anchored text block --
    let y = CARD_SIZE - PAD - blockH;

    ctx.font = `700 ${headline.size}px ${HEAD_FONT}`;
    ctx.fillStyle = "#FFFFFF";
    for (const line of headline.lines) {
      ctx.fillText(line, PAD, y);
      y += nameLineH;
    }

    if (arabic) {
      y += 20;
      ctx.font = `600 ${arabic.size}px ${AR_FONT_FAMILY}`;
      ctx.fillStyle = "#FAF8F4";
      ctx.textAlign = "right";
      ctx.direction = "rtl";
      for (const line of arabic.lines) {
        ctx.fillText(line, PAD + contentW, y);
        y += arLineH;
      }
      ctx.direction = "inherit";
      ctx.textAlign = "left";
    }

    if (feature) {
      y += 26;
      ctx.fillStyle = ACCENT;
      ctx.fillRect(PAD, y, contentW, featureBoxH);
      ctx.font = `600 ${feature.size}px ${HEAD_FONT}`;
      ctx.fillStyle = INK;
      let featureY = y + 14;
      for (const line of feature.lines) {
        ctx.fillText(line, PAD + 18, featureY);
        featureY += featureLineH;
      }
      y += featureBoxH;
    }

    y += 32;
    ctx.font = `700 ${priceSize}px ${HEAD_FONT}`;
    ctx.fillStyle = ACCENT;
    ctx.fillText(priceText, PAD, y);
    y += priceLineH;

    y += 24;
    ctx.font = `500 ${footerSize}px ${HEAD_FONT}`;
    ctx.fillStyle = "rgba(250,248,244,0.85)";
    if ("letterSpacing" in ctx) ctx.letterSpacing = "1px";
    ctx.fillText(footerText, PAD, y);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";

    return await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.94));
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function wrapText(ctx, text, maxWidth) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  let consumed = 0;
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(test).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
    consumed++;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

const s = {
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16, flexWrap: "wrap", gap: 12 },
  h2: { fontSize: 22, fontWeight: 800, margin: 0 },
  sub: { fontSize: 13, color: "#8A7F6D", marginTop: 4 },
  primaryBtn: { background: "#E8792D", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 700, fontSize: 13.5, cursor: "pointer" },
  secondaryBtn: { background: "#fff", color: "#1B2A3D", border: "1.5px solid #DCD5C6", borderRadius: 8, padding: "10px 18px", fontWeight: 700, fontSize: 13.5, cursor: "pointer" },
  filterRow: { display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" },
  chip: { fontSize: 11.5, padding: "6px 12px", borderRadius: 20, border: "1.5px solid #DCD5C6", background: "#fff", color: "#8A7F6D", cursor: "pointer" },
  chipActive: { borderColor: "#1B2A3D", color: "#1B2A3D", background: "#EFEAE0" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 14 },
  card: { background: "#fff", border: "1.5px solid #E4DFD3", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 8 },
  thumb: { width: "100%", height: 140, objectFit: "cover", borderRadius: 8, background: "#F1EDE3" },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  badge: { fontSize: 10, padding: "3px 8px", borderRadius: 6, fontWeight: 700 },
  price: { fontWeight: 800, fontSize: 14.5 },
  name: { fontWeight: 700, fontSize: 15 },
  nameAr: { fontWeight: 700, fontSize: 14, color: "#1B2A3D", direction: "rtl", textAlign: "right" },
  desc: { fontSize: 12.5, color: "#6B6355", lineHeight: 1.5, flex: 1 },
  actions: { display: "flex", gap: 14, marginTop: 4 },
  link: { background: "none", border: "none", color: "#2E7D8C", fontWeight: 700, fontSize: 12.5, cursor: "pointer", padding: 0 },
  empty: { padding: "30px 16px", textAlign: "center", color: "#8A7F6D", fontSize: 13.5, border: "1.5px dashed #DCD5C6", borderRadius: 12, background: "#fff", marginBottom: 14 },
  overlay: { position: "fixed", inset: 0, background: "rgba(27,42,61,0.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50 },
  modal: { background: "#FAF8F4", borderRadius: 14, padding: 22, width: "100%", maxWidth: 420, maxHeight: "85vh", overflowY: "auto" },
  modalTitle: { fontWeight: 800, fontSize: 17, marginBottom: 14 },
  modalActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 },
  label: { display: "block", fontSize: 11.5, fontWeight: 700, color: "#8A7F6D", marginTop: 12, marginBottom: 5 },
  labelRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, marginBottom: 5 },
  input: { width: "100%", boxSizing: "border-box", padding: "9px 11px", borderRadius: 8, border: "1.5px solid #DCD5C6", fontSize: 14, background: "#fff", color: "#1B2A3D" },
};
