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

  const startNew = () => {
    setEditing({ id: null, name: "", category: "3D Print", price: "", description: "", imageUrl: null });
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
  const shareItem = async (item) => {
    const caption = `${item.name} — ${AED(item.price)}${item.description ? `\n${item.description}` : ""}\nDM @_alainprints to order`;
    const safeName = item.name.replace(/[^\w-]+/g, "_") || "item";
    setSharingId(item.id);
    try {
      if (item.imageUrl) {
        try {
          const res = await fetch(item.imageUrl);
          const sourceBlob = await res.blob();
          const cardBlob = await composeShareCard(item, sourceBlob);
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
              placeholder="e.g. Keychain — UAE Plate Style"
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

// Instagram Story canvas (1080x1920, 9:16). The photo sits in a framed box
// up top; name + price sit on a solid navy panel below it — not overlaid on
// the photo itself — so they stay fully legible no matter what's in the shot.
const CARD_W = 1080;
const CARD_H = 1920;

async function composeShareCard(item, sourceBlob) {
  const objectUrl = URL.createObjectURL(sourceBlob);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image failed to load"));
      el.src = objectUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = CARD_W;
    canvas.height = CARD_H;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#1B2A3D";
    ctx.fillRect(0, 0, CARD_W, CARD_H);

    const PAD = 64;
    const TOP_H = 100;
    const CAP_H = 620;

    ctx.font = `800 34px -apple-system, system-ui, sans-serif`;
    ctx.fillStyle = "#FAF8F4";
    ctx.textBaseline = "middle";
    ctx.fillText("alainprints", PAD, TOP_H / 2 + 6);

    // photo, contain-fit inside its framed box, rounded corners
    const boxX = PAD;
    const boxY = TOP_H;
    const boxW = CARD_W - PAD * 2;
    const boxH = CARD_H - TOP_H - CAP_H;
    const fitScale = Math.min(boxW / img.naturalWidth, boxH / img.naturalHeight);
    const drawW = Math.round(img.naturalWidth * fitScale);
    const drawH = Math.round(img.naturalHeight * fitScale);
    const drawX = Math.round(boxX + (boxW - drawW) / 2);
    const drawY = Math.round(boxY + (boxH - drawH) / 2);

    ctx.save();
    roundedRectPath(ctx, drawX, drawY, drawW, drawH, 28);
    ctx.clip();
    ctx.drawImage(img, drawX, drawY, drawW, drawH);
    ctx.restore();

    roundedRectPath(ctx, drawX, drawY, drawW, drawH, 28);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.stroke();

    // caption panel — solid background, guaranteed contrast regardless of the photo
    const capTop = TOP_H + boxH;
    const heartSize = 44;
    const heartGap = 26;
    const centerX = CARD_W / 2;
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(PAD, capTop);
    ctx.lineTo(centerX - heartSize / 2 - heartGap, capTop);
    ctx.moveTo(centerX + heartSize / 2 + heartGap, capTop);
    ctx.lineTo(CARD_W - PAD, capTop);
    ctx.stroke();
    drawHeart(ctx, centerX, capTop, heartSize, "#FFA85C", 3.5);

    const nameFont = `700 56px -apple-system, system-ui, sans-serif`;
    const priceFont = `800 96px -apple-system, system-ui, sans-serif`;
    const ctaFont = `700 34px -apple-system, system-ui, sans-serif`;
    ctx.font = nameFont;
    const nameLines = wrapText(ctx, item.name, CARD_W - PAD * 2, 2);
    const nameLineH = 68;
    const priceLineH = 110;
    const ctaLineH = 46;
    const gap = 30;
    const gap2 = 20;
    const contentH = nameLines.length * nameLineH + gap + priceLineH + gap2 + ctaLineH;

    ctx.textBaseline = "top";
    let y = capTop + (CAP_H - contentH) / 2;
    ctx.fillStyle = "#FFFFFF";
    ctx.font = nameFont;
    for (const line of nameLines) {
      ctx.fillText(line, PAD, y);
      y += nameLineH;
    }
    y += gap;
    ctx.font = priceFont;
    ctx.fillStyle = "#FFA85C";
    ctx.fillText(AED(item.price), PAD, y);
    y += priceLineH + gap2;
    ctx.font = ctaFont;
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText("DM @_alainprints to order", PAD, y);

    return await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// Same hand-drawn heart used in the printed invoice footer, for consistent branding.
function drawHeart(ctx, cx, cy, w, color, lineWidth) {
  const h = w * (90 / 100);
  const x0 = cx - w / 2;
  const y0 = cy - h / 2;
  const px = (nx) => x0 + (nx / 100) * w;
  const py = (ny) => y0 + (ny / 90) * h;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(px(50), py(84));
  ctx.bezierCurveTo(px(24), py(63), px(5), py(44), px(5), py(26));
  ctx.bezierCurveTo(px(5), py(12), px(17), py(4), px(29), py(7));
  ctx.bezierCurveTo(px(39), py(9), px(46), py(17), px(50), py(23));
  ctx.bezierCurveTo(px(54), py(17), px(62), py(9), px(72), py(7));
  ctx.bezierCurveTo(px(85), py(4), px(96), py(13), px(95), py(27));
  ctx.bezierCurveTo(px(94), py(45), px(77), py(63), px(50), py(84));
  ctx.closePath();
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = color;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.restore();
}

function roundedRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
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

  if (consumed < words.length && lines.length) {
    let last = lines[lines.length - 1];
    while (ctx.measureText(`${last}…`).width > maxWidth && last.length > 1) {
      last = last.slice(0, -1).trim();
    }
    lines[lines.length - 1] = `${last}…`;
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
  desc: { fontSize: 12.5, color: "#6B6355", lineHeight: 1.5, flex: 1 },
  actions: { display: "flex", gap: 14, marginTop: 4 },
  link: { background: "none", border: "none", color: "#2E7D8C", fontWeight: 700, fontSize: 12.5, cursor: "pointer", padding: 0 },
  empty: { padding: "30px 16px", textAlign: "center", color: "#8A7F6D", fontSize: 13.5, border: "1.5px dashed #DCD5C6", borderRadius: 12, background: "#fff", marginBottom: 14 },
  overlay: { position: "fixed", inset: 0, background: "rgba(27,42,61,0.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50 },
  modal: { background: "#FAF8F4", borderRadius: 14, padding: 22, width: "100%", maxWidth: 420, maxHeight: "85vh", overflowY: "auto" },
  modalTitle: { fontWeight: 800, fontSize: 17, marginBottom: 14 },
  modalActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 },
  label: { display: "block", fontSize: 11.5, fontWeight: 700, color: "#8A7F6D", marginTop: 12, marginBottom: 5 },
  input: { width: "100%", boxSizing: "border-box", padding: "9px 11px", borderRadius: 8, border: "1.5px solid #DCD5C6", fontSize: 14, background: "#fff", color: "#1B2A3D" },
};
