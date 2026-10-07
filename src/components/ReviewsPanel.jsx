import { useEffect, useState } from "react";
import { fetchReviews, saveReviews } from "../lib/storage";

const blank = { text: "", rating: 5, item: "" };

// Reviews you paste in from WhatsApp / Instagram. The website shows them without any name.
export default function ReviewsPanel() {
  const [reviews, setReviews] = useState([]);
  const [draft, setDraft] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => { fetchReviews().then(setReviews).catch(() => setMessage("Could not load reviews.")); }, []);

  async function persist(next, done) {
    setBusy(true);
    setMessage("");
    try {
      await saveReviews(next);
      setReviews(next);
      setMessage(done);
    } catch {
      setMessage("Could not save. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const add = () => {
    if (!draft.text.trim()) return;
    const review = { id: String(Date.now()), text: draft.text.trim().slice(0, 400), rating: Number(draft.rating) || 5, item: draft.item.trim(), date: new Date().toISOString().slice(0, 10), visible: true };
    persist([review, ...reviews], "Review added. It shows on the website within a minute.").then(() => setDraft(blank));
  };
  const toggle = (id) => persist(reviews.map((review) => (review.id === id ? { ...review, visible: review.visible === false } : review)), "Saved.");
  const remove = (id) => { if (window.confirm("Delete this review?")) persist(reviews.filter((review) => review.id !== id), "Deleted."); };

  return (
    <div className="website-control-panel reviews-panel">
      <div>
        <strong>Customer reviews</strong>
        <small style={{ display: "block", color: "#8A7F6D", marginTop: 3 }}>Paste real feedback from customers. It appears on the website without any name.</small>
      </div>
      <label className="website-announcement">
        <span>Review text</span>
        <textarea rows="3" maxLength="400" value={draft.text} onChange={(event) => setDraft({ ...draft, text: event.target.value })} placeholder="Example: Fast delivery and the colour matched exactly. Will order again!" />
        <small>{draft.text.length}/400</small>
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10 }}>
        <label className="website-announcement"><span>Stars</span>
          <select value={draft.rating} onChange={(event) => setDraft({ ...draft, rating: event.target.value })} style={{ minHeight: 44, borderRadius: 8, border: "1px solid #DCD5C6", padding: "0 10px" }}>
            {[5, 4, 3].map((n) => <option key={n} value={n}>{"★".repeat(n)}</option>)}
          </select>
        </label>
        <label className="website-announcement"><span>What they bought (optional)</span>
          <input value={draft.item} maxLength="60" onChange={(event) => setDraft({ ...draft, item: event.target.value })} placeholder="PETG filament" style={{ minHeight: 44, borderRadius: 8, border: "1px solid #DCD5C6", padding: "0 10px" }} />
        </label>
      </div>
      <div className="website-save-row">
        <span role="status">{message}</span>
        <button type="button" onClick={add} disabled={busy || !draft.text.trim()}>{busy ? "Saving…" : "Add review"}</button>
      </div>
      {reviews.length > 0 && (
        <div style={{ display: "grid", gap: 8 }}>
          {reviews.map((review) => (
            <div key={review.id} style={{ display: "grid", gap: 6, padding: 12, border: "1px solid #E4DFD3", borderRadius: 9, opacity: review.visible === false ? 0.55 : 1 }}>
              <div style={{ color: "#B45309", fontWeight: 800 }}>{"★".repeat(review.rating || 5)} <span style={{ color: "#8A7F6D", fontWeight: 600 }}>{review.item}{review.item ? " · " : ""}{review.date}</span></div>
              <div style={{ lineHeight: 1.45 }}>{review.text}</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" disabled={busy} onClick={() => toggle(review.id)} style={{ minHeight: 40, padding: "0 12px", border: "1px solid #16324F", borderRadius: 8, background: "#fff", color: "#16324F", fontWeight: 800 }}>{review.visible === false ? "Show on website" : "Hide"}</button>
                <button type="button" disabled={busy} onClick={() => remove(review.id)} style={{ minHeight: 40, padding: "0 12px", border: "1px solid #B91C1C", borderRadius: 8, background: "#fff", color: "#B91C1C", fontWeight: 800 }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
