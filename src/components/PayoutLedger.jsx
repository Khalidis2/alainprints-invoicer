import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { AED } from "../lib/helpers";

// Payouts tracker: Stripe payouts go to his bank (+). What he buys for you or gives back in cash (-).
// Balance = money he still holds for you.

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
const blank = () => ({ kind: "purchase", note: "", amount: "", entry_date: today() });
const KIND_LABEL = { payout: "Payout", purchase: "Bought for me", cash_back: "Gave me cash" };

export default function PayoutLedger({ showToast }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(blank);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState("all");
  const toastRef = useRef(showToast);
  toastRef.current = showToast;

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("payout_ledger")
      .select("*")
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) toastRef.current(error.code === "42P01" ? "Run supabase/payout_ledger.sql first" : error.message);
    else setRows(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("payout-ledger")
      .on("postgres_changes", { event: "*", schema: "public", table: "payout_ledger" }, () => load())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [load]);

  const totals = useMemo(() => {
    const sum = (list) => list.reduce((total, row) => total + Number(row.amount || 0), 0);
    const sent = sum(rows.filter((r) => r.kind === "payout" && r.status === "done"));
    const onTheWay = sum(rows.filter((r) => r.kind === "payout" && r.status === "in_transit"));
    const spent = sum(rows.filter((r) => r.kind !== "payout" && r.status === "done"));
    return { sent, onTheWay, spent, balance: sent - spent };
  }, [rows]);

  const withBalance = useMemo(() => {
    let running = 0;
    const map = {};
    [...rows].reverse().forEach((row) => {
      if (row.status === "done") running += row.kind === "payout" ? Number(row.amount) : -Number(row.amount);
      map[row.id] = running;
    });
    return rows
      .filter((row) => filter === "all" || (filter === "in" ? row.kind === "payout" : row.kind !== "payout"))
      .map((row) => ({ ...row, after: map[row.id] }));
  }, [rows, filter]);

  const save = async () => {
    const amount = Number(form.amount);
    if (!form.note.trim()) return showToast("Write what he bought");
    if (!(amount > 0)) return showToast("Enter the amount");
    setBusy(true);
    const record = { kind: form.kind, note: form.note.trim(), amount, entry_date: form.entry_date || today(), status: "done" };
    const { error } = editingId
      ? await supabase.from("payout_ledger").update(record).eq("id", editingId)
      : await supabase.from("payout_ledger").insert(record);
    setBusy(false);
    if (error) return showToast(error.message);
    showToast(editingId ? "Updated" : `Subtracted ${AED(amount)}`);
    setForm(blank());
    setEditingId(null);
    load();
  };

  const edit = (row) => {
    setEditingId(row.id);
    setForm({ kind: row.kind, note: row.note, amount: String(row.amount), entry_date: row.entry_date });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const remove = async (row) => {
    if (!window.confirm(`Delete "${row.note}" (${AED(row.amount)})?`)) return;
    const { error } = await supabase.from("payout_ledger").delete().eq("id", row.id);
    if (error) return showToast(error.message);
    showToast("Deleted");
    load();
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const { data } = await supabase.auth.getSession();
      const response = await fetch("/api/stripe-fees", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${data?.session?.access_token}` },
        body: JSON.stringify({ sync: "payouts" }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Sync failed");
      showToast(`Synced ${result.saved} payouts from Stripe`);
      load();
    } catch (error) {
      showToast(error.message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div>
      <h2 style={{ margin: "0 0 14px", color: "#16324F", fontSize: 26, fontWeight: 850 }}>Payouts</h2>
      <div style={st.cards}>
        <Card label="He holds for you" value={AED(totals.balance)} strong color={totals.balance < 0 ? "#B3451D" : "#0F6B64"} />
        <Card label="Sent to him (paid)" value={AED(totals.sent)} />
        <Card label="Spent / given back" value={AED(totals.spent)} />
        <Card label="On the way" value={AED(totals.onTheWay)} />
      </div>

      <div style={st.panel}>
        <div style={st.panelHead}>
          <strong>{editingId ? "Edit entry" : "Subtract an amount"}</strong>
          <button style={st.ghostBtn} onClick={sync} disabled={syncing}>{syncing ? "Syncing…" : "Sync from Stripe"}</button>
        </div>
        <div style={st.toggle}>
          {["purchase", "cash_back"].map((kind) => (
            <button key={kind} onClick={() => setForm({ ...form, kind })} style={{ ...st.toggleBtn, ...(form.kind === kind ? st.toggleOn : {}) }}>
              {KIND_LABEL[kind]}
            </button>
          ))}
        </div>
        <div style={st.formGrid}>
          <input style={{ ...st.input, gridColumn: "1 / -1" }} placeholder={form.kind === "purchase" ? "What he bought (e.g. 2 spools PLA)" : "Note (e.g. cash handed over)"} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <input style={st.input} type="number" inputMode="decimal" step="0.01" min="0" placeholder="Amount (AED)" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <input style={st.input} type="date" value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button style={st.primaryBtn} onClick={save} disabled={busy}>{busy ? "Saving…" : editingId ? "Save changes" : "Subtract"}</button>
          {editingId && <button style={st.ghostBtn} onClick={() => { setEditingId(null); setForm(blank()); }}>Cancel</button>}
        </div>
      </div>

      <div style={st.panel}>
        <div style={st.panelHead}>
          <strong>History</strong>
          <div style={st.toggle}>
            {[["all", "All"], ["in", "Payouts"], ["out", "Spent"]].map(([id, label]) => (
              <button key={id} onClick={() => setFilter(id)} style={{ ...st.toggleBtn, ...(filter === id ? st.toggleOn : {}) }}>{label}</button>
            ))}
          </div>
        </div>
        {loading && <div style={st.muted}>Loading…</div>}
        {!loading && !withBalance.length && <div style={st.muted}>Nothing yet. Tap "Sync from Stripe" to bring in your old payouts.</div>}
        {withBalance.map((row) => {
          const isIn = row.kind === "payout";
          return (
            <div key={row.id} style={{ ...st.row, opacity: row.status === "failed" ? 0.5 : 1 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={st.rowTitle}>{row.note || KIND_LABEL[row.kind]}</div>
                <div style={st.rowSub}>
                  {row.entry_date} · {KIND_LABEL[row.kind]}
                  {row.status === "in_transit" && <span style={{ ...st.badge, background: "#FFF3D6", color: "#8A5A00" }}>On the way</span>}
                  {row.status === "failed" && <span style={{ ...st.badge, background: "#FBE3DA", color: "#B3451D" }}>Failed</span>}
                  {isIn && row.status === "done" && <span style={{ ...st.badge, background: "#DDF1EC", color: "#0F6B64" }}>Paid</span>}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 800, color: isIn ? "#0F6B64" : "#B3451D" }}>{isIn ? "+" : "−"}{AED(row.amount)}</div>
                <div style={st.rowSub}>Left: {AED(row.after)}</div>
                {!isIn && (
                  <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 4 }}>
                    <button style={st.linkBtn} onClick={() => edit(row)}>Edit</button>
                    <button style={{ ...st.linkBtn, color: "#B3451D" }} onClick={() => remove(row)}>Delete</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Card({ label, value, strong, color }) {
  return (
    <div style={{ ...st.card, ...(strong ? { borderColor: color, borderWidth: 2 } : {}) }}>
      <div style={st.cardLabel}>{label}</div>
      <div style={{ fontWeight: 900, fontSize: strong ? 22 : 17, color: color || "#1B2A3D" }}>{value}</div>
    </div>
  );
}

const st = {
  cards: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 14 },
  card: { background: "#fff", border: "1px solid #E4DFD3", borderRadius: 12, padding: "12px 14px" },
  cardLabel: { fontSize: 11.5, color: "#746A59", fontWeight: 700, marginBottom: 4 },
  panel: { background: "#fff", border: "1px solid #E4DFD3", borderRadius: 12, padding: 14, marginBottom: 14 },
  panelHead: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 },
  toggle: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 },
  toggleBtn: { padding: "7px 12px", borderRadius: 20, border: "1px solid #DCD5C6", background: "#fff", fontWeight: 700, fontSize: 12.5, cursor: "pointer", color: "#746A59" },
  toggleOn: { background: "#0F6B64", borderColor: "#0F6B64", color: "#fff" },
  formGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  input: { width: "100%", padding: "11px 12px", border: "1px solid #DCD5C6", borderRadius: 8, fontSize: 15, boxSizing: "border-box", minWidth: 0 },
  primaryBtn: { padding: "11px 18px", border: 0, borderRadius: 8, background: "#0F6B64", color: "#fff", fontWeight: 800, cursor: "pointer" },
  ghostBtn: { padding: "8px 12px", border: "1px solid #DCD5C6", borderRadius: 8, background: "#fff", color: "#1B2A3D", fontWeight: 700, fontSize: 12.5, cursor: "pointer" },
  linkBtn: { background: "none", border: 0, padding: 0, color: "#0F6B64", fontWeight: 700, fontSize: 12, cursor: "pointer" },
  row: { display: "flex", gap: 10, justifyContent: "space-between", padding: "11px 0", borderTop: "1px solid #F0EBE1" },
  rowTitle: { fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis" },
  rowSub: { fontSize: 11.5, color: "#746A59", marginTop: 2 },
  badge: { marginLeft: 6, padding: "1px 7px", borderRadius: 10, fontSize: 10.5, fontWeight: 800 },
  muted: { color: "#746A59", fontSize: 13, padding: "8px 0" },
};
