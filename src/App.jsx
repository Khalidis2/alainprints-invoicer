import { useState, useEffect, useCallback } from "react";
import {
  fetchItems,
  insertItem,
  updateItemRow,
  deleteItemRow,
  fetchInvoices,
  insertInvoice,
  deleteInvoiceRow,
  fetchInvoiceNo,
  persistInvoiceNo,
  subscribeToChanges,
} from "./lib/storage";
import ItemsMenu from "./components/ItemsMenu";
import InvoiceBuilder from "./components/InvoiceBuilder";
import InvoiceHistory from "./components/InvoiceHistory";

export default function App() {
  const [tab, setTab] = useState("items");
  const [items, setItems] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [invoiceNo, setInvoiceNo] = useState(1000);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const refreshItems = useCallback(() => {
    fetchItems().then(setItems).catch((e) => setLoadError(e.message));
  }, []);
  const refreshInvoices = useCallback(() => {
    fetchInvoices().then(setInvoices).catch((e) => setLoadError(e.message));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [i, inv, n] = await Promise.all([fetchItems(), fetchInvoices(), fetchInvoiceNo()]);
        if (cancelled) return;
        setItems(i);
        setInvoices(inv);
        setInvoiceNo(n);
      } catch (e) {
        if (!cancelled) setLoadError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const unsubscribe = subscribeToChanges({
      onItems: () => refreshItems(),
      onInvoices: () => refreshInvoices(),
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [refreshItems, refreshInvoices]);

  // --- item actions ---
  const handleAddItem = async (item) => {
    await insertItem(item);
    refreshItems();
  };
  const handleUpdateItem = async (item) => {
    await updateItemRow(item);
    refreshItems();
  };
  const handleDeleteItem = async (id) => {
    await deleteItemRow(id);
    refreshItems();
  };

  // --- invoice actions ---
  const handleGenerateInvoice = async (draft) => {
    const saved = await insertInvoice({ ...draft, number: invoiceNo });
    const next = invoiceNo + 1;
    await persistInvoiceNo(next);
    setInvoiceNo(next);
    refreshInvoices();
    return saved;
  };
  const handleDeleteInvoice = async (id) => {
    await deleteInvoiceRow(id);
    refreshInvoices();
  };

  const tabs = [
    { id: "items", label: "Items menu" },
    { id: "invoice", label: "New invoice" },
    { id: "history", label: "History" },
  ];

  if (loading) {
    return (
      <div style={{ ...s.app, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div style={{ color: "#8A7F6D" }}>Loading…</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{ ...s.app, maxWidth: 520, margin: "60px auto", textAlign: "center" }}>
        <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>Couldn't connect to Supabase</div>
        <div style={{ color: "#8A7F6D", fontSize: 13.5, marginBottom: 12 }}>{loadError}</div>
        <div style={{ color: "#8A7F6D", fontSize: 13 }}>
          Check that <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> are set in <code>.env</code>
          (or in your Vercel project's Environment Variables), and that the schema in{" "}
          <code>supabase/schema.sql</code> has been run. See the README.
        </div>
      </div>
    );
  }

  return (
    <div style={s.app}>
      <div className="no-print" style={s.header}>
        <div style={s.brandRow}>
          <Spool />
          <div>
            <div style={s.brandName}>alainprints</div>
            <div style={s.brandSub}>Item catalog & invoice maker · synced</div>
          </div>
        </div>
        <div style={s.tabRow}>
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{ ...s.tabBtn, ...(tab === t.id ? s.tabBtnActive : {}) }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={s.body}>
        {tab === "items" && (
          <ItemsMenu
            items={items}
            onAdd={handleAddItem}
            onUpdate={handleUpdateItem}
            onDelete={handleDeleteItem}
            showToast={showToast}
          />
        )}
        {tab === "invoice" && (
          <InvoiceBuilder items={items} invoiceNo={invoiceNo} onGenerate={handleGenerateInvoice} showToast={showToast} />
        )}
        {tab === "history" && (
          <InvoiceHistory invoices={invoices} onDelete={handleDeleteInvoice} showToast={showToast} />
        )}
      </div>

      {toast && <div style={s.toast}>{toast}</div>}
    </div>
  );
}

function Spool() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
      <circle cx="17" cy="17" r="15" stroke="#E8792D" strokeWidth="2.5" />
      <circle cx="17" cy="17" r="15" stroke="#E8792D" strokeWidth="2.5" strokeDasharray="1.5 4.2" />
      <circle cx="17" cy="17" r="6" fill="#1B2A3D" />
      <circle cx="17" cy="17" r="2" fill="#FAF8F4" />
    </svg>
  );
}

const s = {
  app: {
    minHeight: "100vh",
    background: "#FAF8F4",
    backgroundImage: "linear-gradient(#EFEAE0 1px, transparent 1px), linear-gradient(90deg, #EFEAE0 1px, transparent 1px)",
    backgroundSize: "28px 28px",
    color: "#1B2A3D",
    padding: "20px 16px 60px",
  },
  header: { maxWidth: 980, margin: "0 auto 24px" },
  brandRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 18 },
  brandName: { fontSize: 20, fontWeight: 800 },
  brandSub: { fontSize: 11.5, color: "#8A7F6D", marginTop: 2 },
  tabRow: { display: "flex", gap: 6, borderBottom: "2px solid #E4DFD3" },
  tabBtn: { fontWeight: 700, fontSize: 13.5, padding: "9px 16px", background: "transparent", border: "none", borderBottom: "2px solid transparent", marginBottom: -2, cursor: "pointer", color: "#8A7F6D" },
  tabBtnActive: { color: "#E8792D", borderBottom: "2px solid #E8792D" },
  body: { maxWidth: 980, margin: "0 auto" },
  toast: { position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "#1B2A3D", color: "#fff", padding: "10px 18px", borderRadius: 30, fontSize: 13, fontWeight: 600, boxShadow: "0 6px 20px rgba(0,0,0,0.2)" },
};
