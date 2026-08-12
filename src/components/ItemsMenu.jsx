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
    const caption = `${item.name} — ${AED(item.price)}${item.description ? `\n${item.description}` : ""}\nDM @alainprints to order`;
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
const PANEL_W = 500;
const HEAD_FONT = "'Oswald', 'Arial Narrow', sans-serif";
const AR_FONT_FAMILY = "'Cairo', -apple-system, system-ui, sans-serif";
const INK = "#2E2C28";
const PANEL_BG = "#FAF8F4";
const ACCENT = "#B8D84A";

async function ensureShareFontLoaded() {
  if (!document.fonts) return;
  try {
    await Promise.all([
      document.fonts.load(`400 1em ${HEAD_FONT}`),
      document.fonts.load(`500 1em ${HEAD_FONT}`),
      document.fonts.load(`700 1em ${AR_FONT_FAMILY}`),
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

function drawImageCover(ctx, img, x, y, w, h) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const drawW = img.naturalWidth * scale;
  const drawH = img.naturalHeight * scale;
  const offsetX = x - (drawW - w) / 2;
  const offsetY = y - (drawH - h) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
  ctx.restore();
}

function drawTransparentProduct(ctx, img, x, y, w, h) {
  const scan = document.createElement("canvas");
  scan.width = img.naturalWidth;
  scan.height = img.naturalHeight;
  const scanCtx = scan.getContext("2d", { willReadFrequently: true });
  scanCtx.drawImage(img, 0, 0);
  const pixels = scanCtx.getImageData(0, 0, scan.width, scan.height).data;
  let minX = scan.width;
  let minY = scan.height;
  let maxX = -1;
  let maxY = -1;

  for (let py = 0; py < scan.height; py++) {
    for (let px = 0; px < scan.width; px++) {
      if (pixels[(py * scan.width + px) * 4 + 3] > 12) {
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);
      }
    }
  }

  const hasTransparencyBounds = maxX >= minX && maxY >= minY;
  const sourceX = hasTransparencyBounds ? minX : 0;
  const sourceY = hasTransparencyBounds ? minY : 0;
  const sourceW = hasTransparencyBounds ? maxX - minX + 1 : img.naturalWidth;
  const sourceH = hasTransparencyBounds ? maxY - minY + 1 : img.naturalHeight;
  const paddingX = 8;
  const paddingY = 24;
  const scale = Math.min((w - paddingX * 2) / sourceW, (h - paddingY * 2) / sourceH);
  const drawW = sourceW * scale;
  const drawH = sourceH * scale;
  const drawX = x + w - drawW + 18;
  const drawY = y + (h - drawH) / 2;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, sourceX, sourceY, sourceW, sourceH, drawX, drawY, drawW, drawH);
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

    ctx.fillStyle = PANEL_BG;
    ctx.fillRect(0, 0, CARD_SIZE, CARD_SIZE);
    ctx.save();
    ctx.filter = "brightness(1.04) contrast(1.04) saturate(1.02)";
    drawImageCover(ctx, img, PANEL_W, 0, CARD_SIZE - PANEL_W, CARD_SIZE);
    ctx.restore();

    const photoW = CARD_SIZE - PANEL_W;
    const light = ctx.createRadialGradient(
      PANEL_W + photoW * 0.42,
      CARD_SIZE * 0.34,
      20,
      PANEL_W + photoW * 0.42,
      CARD_SIZE * 0.34,
      photoW * 0.78
    );
    light.addColorStop(0, "rgba(255,255,255,0.18)");
    light.addColorStop(0.55, "rgba(255,255,255,0.02)");
    light.addColorStop(1, "rgba(25,28,32,0.13)");
    ctx.fillStyle = light;
    ctx.fillRect(PANEL_W, 0, photoW, CARD_SIZE);

    const polish = ctx.createLinearGradient(PANEL_W, 0, CARD_SIZE, CARD_SIZE);
    polish.addColorStop(0, "rgba(244,247,241,0.11)");
    polish.addColorStop(0.48, "rgba(255,255,255,0)");
    polish.addColorStop(1, "rgba(184,216,74,0.055)");
    ctx.fillStyle = polish;
    ctx.fillRect(PANEL_W, 0, photoW, CARD_SIZE);

    const edgeShade = ctx.createLinearGradient(PANEL_W, 0, PANEL_W + 76, 0);
    edgeShade.addColorStop(0, "rgba(46,44,40,0.12)");
    edgeShade.addColorStop(1, "rgba(46,44,40,0)");
    ctx.fillStyle = edgeShade;
    ctx.fillRect(PANEL_W, 0, 76, CARD_SIZE);

    const PAD = 64;
    const contentW = PANEL_W - PAD * 2;
    ctx.textBaseline = "top";

    // brand
    ctx.font = `400 24px ${HEAD_FONT}`;
    ctx.fillStyle = INK;
    if ("letterSpacing" in ctx) ctx.letterSpacing = "2px";
    ctx.fillText("ALAINPRINTS", PAD, 64);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";

    let y = 154;

    const headline = fitWrappedText(ctx, item.name.toUpperCase(), 400, HEAD_FONT, contentW, 5, 66, 38);
    const nameLineH = Math.round(headline.size * 1.04);
    ctx.font = `400 ${headline.size}px ${HEAD_FONT}`;
    ctx.fillStyle = INK;
    for (const line of headline.lines) {
      ctx.fillText(line, PAD, y);
      y += nameLineH;
    }

    // Arabic name, right-aligned within the panel, full, wraps as needed
    if (item.nameAr) {
      y += 24;
      const arabicName = formatArabicProductName(item.nameAr);
      const arabic = fitWrappedText(ctx, arabicName, 600, AR_FONT_FAMILY, contentW, 2, 34, 22);
      const arLineH = Math.round(arabic.size * 1.42);
      ctx.font = `600 ${arabic.size}px ${AR_FONT_FAMILY}`;
      ctx.fillStyle = INK;
      ctx.textAlign = "right";
      ctx.direction = "rtl";
      for (const line of arabic.lines) {
        ctx.fillText(line, PAD + contentW, y);
        y += arLineH;
      }
      ctx.direction = "inherit";
      ctx.textAlign = "left";
    }

    if (item.description) {
      y += 28;
      const feature = fitWrappedText(ctx, item.description.toUpperCase(), 400, HEAD_FONT, contentW - 36, 3, 28, 20);
      const featureLineH = Math.round(feature.size * 1.15);
      const boxH = feature.lines.length * featureLineH + 30;
      ctx.fillStyle = ACCENT;
      ctx.fillRect(PAD, y, contentW, boxH);
      ctx.font = `400 ${feature.size}px ${HEAD_FONT}`;
      ctx.fillStyle = INK;
      let featureY = y + 15;
      for (const line of feature.lines) {
        ctx.fillText(line, PAD + 18, featureY);
        featureY += featureLineH;
      }
      y += boxH;
    }

    y += 34;
    ctx.fillStyle = INK;
    ctx.fillRect(PAD, y, 132, 3);
    y += 34;
    const priceText = formatCardPrice(item.price);
    const priceSize = fitFontSize(ctx, priceText, 400, HEAD_FONT, contentW, 76, 40);
    ctx.font = `400 ${priceSize}px ${HEAD_FONT}`;
    ctx.fillStyle = INK;
    ctx.fillText(priceText, PAD, y);

    const footerText = "3D PRINTED IN UAE  •  DM @alainprints";
    const footerSize = fitFontSize(ctx, footerText, 400, HEAD_FONT, contentW, 18, 14);
    ctx.font = `400 ${footerSize}px ${HEAD_FONT}`;
    ctx.fillStyle = INK;
    if ("letterSpacing" in ctx) ctx.letterSpacing = "1px";
    ctx.fillText(footerText, PAD, CARD_SIZE - PAD - footerSize);
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
