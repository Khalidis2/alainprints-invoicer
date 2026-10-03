import { useState, useEffect, useCallback } from "react";
import { supabase } from "./lib/supabaseClient";
import {
  fetchItems,
  insertItem,
  updateItemRow,
  deleteItemRow,
  fetchInvoices,
  insertInvoice,
  updateInvoiceRow,
  deleteInvoiceRow,
  fetchInvoiceNo,
  persistInvoiceNo,
  subscribeToChanges,
  fetchCustomers,
  upsertCustomer,
  updateCustomerRow,
  fetchFilaments,
  syncFilamentInventoryOnce,
  updateFilamentRow,
  receiveFilamentRow,
  fetchStoreOrders,
  setStoreOrderStatus,
} from "./lib/storage";
import ItemsMenu from "./components/ItemsMenu";
import InvoiceBuilder from "./components/InvoiceBuilder";
import InvoiceHistory from "./components/InvoiceHistory";
import PrintCalculator from "./components/PrintCalculator";
import Customers from "./components/Customers";
import FilamentInventory from "./components/FilamentInventory";
import StoreOrders from "./components/StoreOrders";
import AdminDashboard from "./components/AdminDashboard";
import WebsiteSettings from "./components/WebsiteSettings";

export default function App() {
  const [session, setSession] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        setSession(data.session);
        setCheckingAuth(false);
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setCheckingAuth(false);
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  if (checkingAuth) return <div style={authStyles.center}>Checking secure session...</div>;
  if (!session) return <Login />;

  return <Invoicer userEmail={session.user.email} onSignOut={() => supabase.auth.signOut()} />;
}

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const signIn = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (authError) setError("Incorrect email or password.");
    setBusy(false);
  };

  return (
    <main style={authStyles.page}>
      <form style={authStyles.card} onSubmit={signIn}>
        <div style={authStyles.brand}>ALAINPRINTS</div>
        <h1 style={authStyles.title}>PrintTools3D admin</h1>
        <p style={authStyles.sub}>Sign in to manage stock, products, orders, customers and invoices.</p>
        <label style={authStyles.label}>Email</label>
        <input style={authStyles.input} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <label style={authStyles.label}>Password</label>
        <input style={authStyles.input} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <div style={authStyles.error}>{error}</div>}
        <button style={authStyles.button} disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button>
      </form>
    </main>
  );
}

const authStyles = {
  page: { minHeight: "100vh", display: "grid", placeItems: "center", padding: 20, background: "#FAF8F4" },
  center: { minHeight: "100vh", display: "grid", placeItems: "center", color: "#8A7F6D" },
  card: { width: "100%", maxWidth: 390, background: "#fff", border: "1px solid #E4DFD3", borderRadius: 16, padding: 28, boxShadow: "0 10px 35px rgba(27,42,61,.08)" },
  brand: { color: "#16324F", fontWeight: 900, letterSpacing: 4, fontSize: 18 },
  title: { margin: "18px 0 4px", color: "#1B2A3D", fontSize: 24 },
  sub: { margin: "0 0 22px", color: "#8A7F6D", fontSize: 13 },
  label: { display: "block", margin: "13px 0 5px", color: "#6B6355", fontWeight: 700, fontSize: 12 },
  input: { width: "100%", padding: "11px 12px", border: "1px solid #DCD5C6", borderRadius: 8, fontSize: 15 },
  error: { marginTop: 12, color: "#B3451D", fontSize: 12 },
  button: { width: "100%", marginTop: 18, padding: 12, border: 0, borderRadius: 8, background: "#16324F", color: "#fff", fontWeight: 800, cursor: "pointer" },
};

function Invoicer({ userEmail, onSignOut }) {
  const [tab, setTab] = useState("dashboard");
  const [items, setItems] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [filaments, setFilaments] = useState([]);
  const [storeOrders, setStoreOrders] = useState([]);
  const [invoiceNo, setInvoiceNo] = useState(1000);
  const [editingInvoice, setEditingInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), Math.max(2200, String(msg).length * 60));
  };

  const refreshItems = useCallback(() => {
    fetchItems().then(setItems).catch((e) => setLoadError(e.message));
  }, []);
  const refreshInvoices = useCallback(() => {
    fetchInvoices().then(setInvoices).catch((e) => setLoadError(e.message));
  }, []);
  const refreshCustomers = useCallback(() => {
    fetchCustomers().then(setCustomers).catch((e) => showToast(e.message));
  }, []);
  const refreshFilaments = useCallback(() => {
    fetchFilaments().then(setFilaments).catch((e) => showToast(e.message));
  }, []);
  const refreshStoreOrders = useCallback(() => {
    fetchStoreOrders().then(setStoreOrders).catch((e) => showToast(e.message));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await syncFilamentInventoryOnce();
        const [i, inv, n, savedCustomers, savedFilaments, savedStoreOrders] = await Promise.all([fetchItems(), fetchInvoices(), fetchInvoiceNo(), fetchCustomers(), fetchFilaments(), fetchStoreOrders()]);
        if (cancelled) return;
        setItems(i);
        setInvoices(inv);
        setInvoiceNo(n);
        setCustomers(savedCustomers);
        setFilaments(savedFilaments);
        setStoreOrders(savedStoreOrders);
      } catch (e) {
        if (!cancelled) setLoadError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const unsubscribe = subscribeToChanges({
      onItems: () => refreshItems(),
      onInvoices: () => refreshInvoices(),
      onCustomers: () => refreshCustomers(),
      onFilaments: () => refreshFilaments(),
      onStoreOrders: () => refreshStoreOrders(),
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [refreshItems, refreshInvoices, refreshCustomers, refreshFilaments, refreshStoreOrders]);

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
    const number = Number(draft.number);
    const saved = await insertInvoice({ ...draft, number });
    try {
      await upsertCustomer(draft.customer);
      refreshCustomers();
    } catch (error) {
      if (error.code !== "42P01") showToast("Invoice saved, but customer couldn't be updated");
    }
    const next = Math.max(invoiceNo + 1, number + 1);
    await persistInvoiceNo(next);
    setInvoiceNo(next);
    refreshInvoices();
    refreshFilaments();
    return saved;
  };
  const handleUpdateInvoice = async (draft) => {
    const saved = await updateInvoiceRow(draft);
    try {
      await upsertCustomer(draft.customer);
      refreshCustomers();
    } catch (error) {
      if (error.code !== "42P01") showToast("Invoice updated, but customer couldn't be updated");
    }
    const next = Math.max(invoiceNo, Number(draft.number) + 1);
    await persistInvoiceNo(next);
    setInvoiceNo(next);
    refreshInvoices();
    refreshFilaments();
    return saved;
  };
  const handleDeleteInvoice = async (id) => {
    await deleteInvoiceRow(id);
    refreshInvoices();
  };
  const handleEditInvoice = (invoice) => {
    if (!["Draft", "Unpaid"].includes(invoice.status || "Unpaid")) {
      showToast("Paid and cancelled invoices are locked");
      return;
    }
    setEditingInvoice(invoice);
    setTab("invoice");
  };
  const finishEditing = () => {
    setEditingInvoice(null);
    setTab("history");
  };

  const handleUpdateCustomer = async (customer) => {
    await updateCustomerRow(customer);
    refreshCustomers();
  };

  const handleUpdateFilament = async (filament) => {
    await updateFilamentRow(filament);
    refreshFilaments();
  };
  const handleReceiveFilament = async (filament) => {
    await receiveFilamentRow(filament);
    refreshFilaments();
  };
  const handleStoreOrderStatus = async (id, status) => {
    await setStoreOrderStatus(id, status);
    await Promise.all([refreshStoreOrders(), refreshFilaments()]);
  };

  const pendingOrders = storeOrders.filter((order) => order.status === "pending").length;
  const tabGroups = [
    {
      label: "Store admin",
      tabs: [
        { id: "dashboard", label: "Dashboard" },
        { id: "filament", label: "Stock" },
        { id: "items", label: "Products" },
        { id: "store-orders", label: `Orders${pendingOrders ? ` (${pendingOrders})` : ""}` },
        { id: "settings", label: "Website" },
      ],
    },
    {
      label: "alainprints invoicer",
      tabs: [
        { id: "invoice", label: "New invoice" },
        { id: "history", label: "Invoices" },
        { id: "customers", label: "Customers" },
        { id: "calculator", label: "Slice & price" },
      ],
    },
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
    <div className="app-shell" style={s.app}>
      <div className="no-print app-header" style={s.header}>
        <div className="brand-row" style={s.brandRow}>
          <Spool />
          <div>
            <div style={s.brandName}>alainprints</div>
            <div style={s.brandSub}>PrintTools3D business admin · synced</div>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: -50, marginBottom: 20 }}>
          <span style={{ fontSize: 11, color: "#8A7F6D", marginRight: 10 }}>{userEmail}</span>
          <button style={s.signOutBtn} onClick={onSignOut}>Sign out</button>
        </div>
        <nav className="tab-groups" aria-label="Admin sections">
          {tabGroups.map((group) => (
            <div className="tab-group" key={group.label}>
              <span className="tab-group-label">{group.label}</span>
              <div className="app-tabs" style={s.tabRow}>
                {group.tabs.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setTab(t.id);
                      if (t.id !== "invoice") setEditingInvoice(null);
                    }}
                    style={{ ...s.tabBtn, ...(tab === t.id ? s.tabBtnActive : {}) }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </div>

      <div className="app-body" style={s.body}>
        {tab === "dashboard" && (
          <AdminDashboard
            items={items}
            invoices={invoices}
            customers={customers}
            filaments={filaments}
            storeOrders={storeOrders}
            onNavigate={setTab}
          />
        )}
        {tab === "items" && (
          <ItemsMenu
            items={items}
            onAdd={handleAddItem}
            onUpdate={handleUpdateItem}
            onDelete={handleDeleteItem}
            showToast={showToast}
          />
        )}
        {tab === "calculator" && (
          <PrintCalculator
            filaments={filaments}
            onAdd={handleAddItem}
            onAdded={() => {
              showToast("Calculated item added");
              setTab("items");
            }}
          />
        )}
        {tab === "filament" && (
          <FilamentInventory
            filaments={filaments}
            onUpdate={handleUpdateFilament}
            onReceive={handleReceiveFilament}
            showToast={showToast}
          />
        )}
        {tab === "store-orders" && (
          <StoreOrders orders={storeOrders} onStatus={handleStoreOrderStatus} showToast={showToast} />
        )}
        {tab === "invoice" && (
          <InvoiceBuilder
            key={editingInvoice?.id ?? "new-invoice"}
            items={items}
            customers={customers}
            filaments={filaments}
            invoiceNo={invoiceNo}
            initialInvoice={editingInvoice}
            onSave={editingInvoice ? handleUpdateInvoice : handleGenerateInvoice}
            onFinished={editingInvoice ? finishEditing : null}
            onCancel={editingInvoice ? finishEditing : null}
            showToast={showToast}
          />
        )}
        {tab === "customers" && (
          <Customers
            customers={customers}
            invoices={invoices}
            onUpdate={handleUpdateCustomer}
            showToast={showToast}
          />
        )}
        {tab === "history" && (
          <InvoiceHistory invoices={invoices} onEdit={handleEditInvoice} onUpdate={handleUpdateInvoice} onDelete={handleDeleteInvoice} onRefresh={refreshInvoices} showToast={showToast} />
        )}
        {tab === "settings" && (
          <WebsiteSettings filaments={filaments} items={items} />
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
  signOutBtn: { background: "#fff", color: "#1B2A3D", border: "1px solid #DCD5C6", borderRadius: 7, padding: "6px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" },
  toast: { position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "#1B2A3D", color: "#fff", padding: "10px 18px", borderRadius: 30, fontSize: 13, fontWeight: 600, boxShadow: "0 6px 20px rgba(0,0,0,0.2)" },
};
