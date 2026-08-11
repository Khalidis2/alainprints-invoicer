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
  const [shareStage, setShareStage] = useState("");
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
      const res = await fetch(
        `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ar&dt=t&q=${encodeURIComponent(text)}`
      );
      if (!res.ok) throw new Error("translate request failed");
      const data = await res.json();
      const translated = data[0].map((chunk) => chunk[0]).join("");
      setEditing((prev) => ({ ...prev, nameAr: translated }));
    } catch (err) {
      showToast("Couldn't auto-translate — type it manually instead");
    } finally {
      setTranslating(false);
    }
  };
  const shareItem = async (item) => {
    const caption = `${item.name} — ${AED(item.price)}${item.description ? `\n${item.description}` : ""}\nDM @_alainprints to order`;
    const safeName = item.name.replace(/[^\w-]+/g, "_") || "item";
    setSharingId(item.id);
    try {
      if (item.imageUrl) {
        try {
          const res = await fetch(item.imageUrl);
          const rawBlob = await res.blob();
          let sourceBlob = rawBlob;
          let isolated = false;
          setShareStage("Removing background…");
          try {
            sourceBlob = await removeProductBackground(rawBlob);
            isolated = true;
          } catch (bgErr) {
            // background removal unavailable/failed — fall back to the photo as-is
          }
          setShareStage("Preparing…");
          const cardBlob = await composeShareCard(item, sourceBlob, isolated);
          const file = new File([cardBlob], `${safeName}.jpg`, { type: "image/jpeg" });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: item.name, text: caption });
            return;
          }
          if (!navigator.share) {
            const dlUrl = URL.createObjectURL(cardBlob);
            const a = document.createElement("a");
            a.href = dlUrl;
            a.download = `${safeName}.jpg`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(dlUrl);
            await navigator.clipboard.writeText(caption);
            showToast("Image downloaded & caption copied — share isn't supported on this browser");
            return;
          }
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
      setShareStage("");
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
      showToast("Couldn't save item — check connection");
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
                  {sharingId === item.id ? shareStage || "Sharing…" : "Share"}
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

            <label style={s.label}>Description</label>
            <textarea
              style={{ ...s.input, minHeight: 70, resize: "vertical" }}
              value={editing.description}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              placeholder="Short description shown to customers"
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

// Square (1:1) ecommerce-style listing card. Photo fills the right side
// full-bleed (cover-fit); a clean typographic panel sits on the left —
// mineral-white background, graphite text, one restrained lime accent on
// the price only. No icons, dots, gradients, or shadows.
const CARD_SIZE = 1080;
const PANEL_W = 460;
const HEAD_FONT = "'Archivo Condensed', -apple-system, system-ui, sans-serif";
const AR_FONT_FAMILY = "'Cairo', -apple-system, system-ui, sans-serif";
const INK = "#2E2C28";
const INK_MUTED = "rgba(46,44,40,0.6)";
const PANEL_BG = "#FAF8F4";
const PHOTO_BG = "#E7E4DC";
const ACCENT = "#B7BE5A";

// Loaded on demand (only when Share is used) so it doesn't bloat the main
// app bundle — the model itself (~40MB) is fetched from IMG.LY's CDN on
// first use per device, then cached by the browser.
async function removeProductBackground(blob) {
  const { default: removeBackground } = await import("@imgly/background-removal");
  return await removeBackground(blob, { model: "isnet_quint8" });
}

async function ensureShareFontLoaded() {
  if (!document.fonts) return;
  try {
    await Promise.all([
      document.fonts.load(`800 1em ${HEAD_FONT}`),
      document.fonts.load(`700 1em ${HEAD_FONT}`),
      document.fonts.load(`600 1em ${HEAD_FONT}`),
      document.fonts.load(`700 1em ${AR_FONT_FAMILY}`),
    ]);
  } catch (err) {
    // font failed to load — canvas will fall back to the system font
  }
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

function drawImageContain(ctx, img, x, y, w, h, padding) {
  const availW = w - padding * 2;
  const availH = h - padding * 2;
  const scale = Math.min(availW / img.naturalWidth, availH / img.naturalHeight);
  const drawW = img.naturalWidth * scale;
  const drawH = img.naturalHeight * scale;
  const drawX = x + (w - drawW) / 2;
  const drawY = y + (h - drawH) / 2;
  ctx.drawImage(img, drawX, drawY, drawW, drawH);
}

async function composeShareCard(item, sourceBlob, isolated) {
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

    ctx.fillStyle = PANEL_BG;
    ctx.fillRect(0, 0, CARD_SIZE, CARD_SIZE);
    if (isolated) {
      ctx.fillStyle = PHOTO_BG;
      ctx.fillRect(PANEL_W, 0, CARD_SIZE - PANEL_W, CARD_SIZE);
      drawImageContain(ctx, img, PANEL_W, 0, CARD_SIZE - PANEL_W, CARD_SIZE, 60);
    } else {
      drawImageCover(ctx, img, PANEL_W, 0, CARD_SIZE - PANEL_W, CARD_SIZE);
    }

    const PAD = 56;
    const contentW = PANEL_W - PAD * 2;
    ctx.textBaseline = "top";

    // brand
    ctx.font = `700 26px ${HEAD_FONT}`;
    ctx.fillStyle = INK;
    if ("letterSpacing" in ctx) ctx.letterSpacing = "2px";
    ctx.fillText("ALAINPRINTS", PAD, 60);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";

    let y = 60 + 46;

    // headline — item name, uppercase, condensed
    const headFont = `800 62px ${HEAD_FONT}`;
    ctx.font = headFont;
    const nameLines = wrapText(ctx, item.name.toUpperCase(), contentW, 4);
    const nameLineH = 60;
    ctx.fillStyle = INK;
    for (const line of nameLines) {
      ctx.fillText(line, PAD, y);
      y += nameLineH;
    }

    // Arabic name, right-aligned within the panel, wrapped to fit
    if (item.nameAr) {
      y += 14;
      const arFont = `700 38px ${AR_FONT_FAMILY}`;
      ctx.font = arFont;
      const arLines = wrapText(ctx, item.nameAr, contentW, 2);
      const arLineH = 46;
      ctx.fillStyle = INK;
      ctx.textAlign = "right";
      for (const line of arLines) {
        ctx.fillText(line, PAD + contentW, y);
        y += arLineH;
      }
      ctx.textAlign = "left";
      y += 4;
    }

    // feature line, from the description if present
    if (item.description) {
      y += 20;
      const feature = item.description.length > 42 ? `${item.description.slice(0, 41).trim()}…` : item.description;
      ctx.font = `700 22px ${HEAD_FONT}`;
      ctx.fillStyle = INK_MUTED;
      if ("letterSpacing" in ctx) ctx.letterSpacing = "1px";
      ctx.fillText(feature.toUpperCase(), PAD, y);
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
      y += 40;
    }

    // price — the one accented element
    y += 36;
    ctx.font = `800 80px ${HEAD_FONT}`;
    ctx.fillStyle = ACCENT;
    ctx.fillText(AED(item.price), PAD, y);

    // footer, pinned to the bottom of the panel
    const footerText = "3D PRINTED IN UAE  •  DM @_ALAINPRINTS";
    ctx.font = `600 20px ${HEAD_FONT}`;
    ctx.fillStyle = INK_MUTED;
    if ("letterSpacing" in ctx) ctx.letterSpacing = "1px";
    ctx.fillText(footerText, PAD, CARD_SIZE - PAD - 24, contentW);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";

    return await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.94));
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function wrapText(ctx, text, maxWidth, maxLines) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  let consumed = 0;
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(test).width > maxWidth) {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    } else {
      current = test;
    }
    consumed++;
  }
  if (lines.length < maxLines && current) lines.push(current);

  // If content overflows, prefer dropping whole trailing words over chopping
  // mid-word — walk backward from the last line until "<line>…" fits.
  if (consumed < words.length && lines.length) {
    for (let idx = lines.length - 1; idx >= 0; idx--) {
      const withEllipsis = `${lines[idx]}…`;
      if (ctx.measureText(withEllipsis).width <= maxWidth) {
        lines[idx] = withEllipsis;
        lines.length = idx + 1;
        return lines;
      }
    }
    // fallback: even a single word doesn't fit — character-truncate it
    let last = lines[0] || "";
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
      last = last.slice(0, -1).trim();
    }
    lines[0] = `${last}…`;
    lines.length = 1;
  }
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
