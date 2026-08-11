import { useState } from "react";
import { AED, CATEGORIES, CAT_STYLE } from "../lib/helpers";
import { uploadItemImage } from "../lib/storage";

export default function ItemsMenu({ items, onAdd, onUpdate, onDelete, showToast }) {
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState("All");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

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
    const caption = `${item.name} — ${AED(item.price)}${item.description ? `\n${item.description}` : ""}`;
    try {
      if (item.imageUrl && navigator.canShare) {
        try {
          const res = await fetch(item.imageUrl);
          const blob = await res.blob();
          const ext = (blob.type.split("/")[1] || "jpg").split("+")[0];
          const file = new File([blob], `${item.name.replace(/[^\w-]+/g, "_")}.${ext}`, { type: blob.type });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: item.name, text: caption });
            return;
          }
        } catch (fetchErr) {
          // couldn't fetch/attach the image — fall through to a link/text share
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
                <button style={{ ...s.link, color: "#E8792D" }} onClick={() => shareItem(item)}>
                  Share
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
