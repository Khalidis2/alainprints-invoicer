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
  makeAllFilamentKingroon,
  setPetgBasicPrice,
  addFilamentRow,
  archiveFilamentRow,
  restoreFilamentRow,
  fetchArchivedFilaments,
  updateFilamentRow,
  receiveFilamentRow,
  fetchStoreOrders,
  fetchPendingReviews,
  setStoreOrderStatus,
  setTestSpool,
} from "./lib/storage";
import ItemsMenu from "./components/ItemsMenu";
import InvoiceBuilder from "./components/InvoiceBuilder";
import InvoiceHistory from "./components/InvoiceHistory";
import PrintCalculator from "./components/PrintCalculator";
import Customers from "./components/Customers";
import FilamentInventory from "./components/FilamentInventory";
import StoreOrders from "./components/StoreOrders";
import Sales from "./components/Sales";
import PriceList from "./components/PriceList";
import AdminDashboard from "./components/AdminDashboard";
import { describeStockChange, describeStockEdit } from "./lib/stockCheck";
import WebsiteSettings from "./components/WebsiteSettings";
import PayoutLedger from "./components/PayoutLedger";
import Navigation, { MoreMenu } from "./components/Navigation";
import SearchPage from "./components/SearchPage";

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
        <img src="/logo-round.png" alt="Alain Prints" width="72" height="72" style={{ display: "block", margin: "0 0 12px", borderRadius: "50%" }} />
        <div style={authStyles.brand}>ALAINPRINTS</div>
        <h1 style={authStyles.title}>Alain Prints admin</h1>
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
  center: { minHeight: "100vh", display: "grid", placeItems: "center", color: "#746A59" },
  card: { width: "100%", maxWidth: 390, background: "#fff", border: "1px solid #E4DFD3", borderRadius: 16, padding: 28, boxShadow: "0 10px 35px rgba(27,42,61,.08)" },
  brand: { color: "#16324F", fontWeight: 900, letterSpacing: 4, fontSize: 18 },
  title: { margin: "18px 0 4px", color: "#1B2A3D", fontSize: 24 },
  sub: { margin: "0 0 22px", color: "#746A59", fontSize: 13 },
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
  const [pendingReviewCount, setPendingReviewCount] = useState(0);
  const [invoiceNo, setInvoiceNo] = useState(1000);
  const [editingInvoice, setEditingInvoice] = useState(null);
  // Starting point for a new invoice: a chosen customer, a duplicated invoice, a repeated order.
  const [prefill, setPrefill] = useState(null);
  // An invoice to open straight on its detail screen (used by Search).
  const [openInvoiceId, setOpenInvoiceId] = useState(null);
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
        try { await makeAllFilamentKingroon(); } catch (e) { console.error("Kingroon tidy-up failed", e); }
        // Wakes the server-side one-time price updates (same endpoint the store uses); safe to ignore failures.
        fetch("/api/store-stock").catch(() => {});
        try { await setPetgBasicPrice(); } catch (e) { console.error("PETG price update failed", e); }
        const [i, inv, n, savedCustomers, savedFilaments, savedStoreOrders] = await Promise.all([fetchItems(), fetchInvoices(), fetchInvoiceNo(), fetchCustomers(), fetchFilaments(), fetchStoreOrders()]);
        if (cancelled) return;
        setItems(i);
        setInvoices(inv);
        setInvoiceNo(n);
        setCustomers(savedCustomers);
        setFilaments(savedFilaments);
        setStoreOrders(savedStoreOrders);
        fetchPendingReviews().then((list) => !cancelled && setPendingReviewCount(list.length)).catch(() => {});
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
    const before = ["Unpaid", "Paid"].includes(draft.status) && (draft.lines || []).some((line) => line.filamentId) ? await fetchFilaments().catch(() => null) : null;
    const saved = await insertInvoice({ ...draft, number });
    if (before) {
      // Read the stock again and show what really happened, instead of assuming it worked.
      fetchFilaments().then((after) => {
        const result = describeStockChange(draft.lines, before, after);
        if (result.moved) showToast(result.text);
      }).catch(() => {});
    }
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
    // Edits can add, remove or change spools: show the real stock before and after.
    const oldLines = invoices.find((invoice) => invoice.id === draft.id)?.lines || [];
    const touchesStock = [...oldLines, ...(draft.lines || [])].some((line) => line.filamentId);
    const before = touchesStock ? await fetchFilaments().catch(() => null) : null;
    const saved = await updateInvoiceRow(draft);
    if (before) {
      fetchFilaments().then((after) => {
        const text = describeStockEdit(oldLines, draft.lines, before, after);
        if (text) showToast(text);
      }).catch(() => {});
    }
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
    setPrefill(null);
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
  const handleAddFilament = async (filament) => {
    await addFilamentRow(filament);
    refreshFilaments();
  };
  const handleArchiveFilament = async (id) => {
    await archiveFilamentRow(id);
    refreshFilaments();
  };
  const handleRestoreFilament = async (id) => {
    await restoreFilamentRow(id);
    refreshFilaments();
  };
  const handleReceiveFilament = async (filament) => {
    await receiveFilamentRow(filament);
    refreshFilaments();
  };
  const handleStoreOrderStatus = async (id, status) => {
    try {
      await setStoreOrderStatus(id, status);
    } finally {
      // Also on failure: a reservation that timed out is now "expired", so show it that way.
      await Promise.all([refreshStoreOrders(), refreshFilaments()]);
    }
  };
  const handleTestSpool = async (on) => {
    await setTestSpool(on);
    await refreshFilaments();
  };

  // Changes made on another device (phone, laptop) show up when you come back to this tab.
  useEffect(() => {
    let last = Date.now();
    const refresh = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 20000) return;
      last = Date.now();
      refreshInvoices();
      refreshFilaments();
      fetchStoreOrders().then(setStoreOrders).catch(() => {});
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [refreshInvoices, refreshFilaments]);

  const pendingOrders = storeOrders.filter((order) => order.status === "pending").length;
  // "All sales" counts everything waiting: pending website orders and unpaid invoices.
  const needsAttention = pendingOrders + invoices.filter((invoice) => ["Unpaid", "Draft"].includes(invoice.status || "Unpaid")).length;
  const go = (id, opts) => {
    setTab(id);
    if (id !== "invoice" || opts?.fresh) {
      setEditingInvoice(null);
      setPrefill(null);
    }
    window.scrollTo?.(0, 0);
  };
  const openInvoice = (id) => {
    setOpenInvoiceId(id);
    setTab("history");
    window.scrollTo?.(0, 0);
  };
  // Ctrl/Cmd+K, or "/" when not typing, jumps to Search from anywhere.
  useEffect(() => {
    const onKey = (event) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        go("search");
      } else if (event.key === "/" && !typing && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        go("search");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const startInvoice = (draft) => {
    setEditingInvoice(null);
    setPrefill({ ...draft, key: Date.now() });
    setTab("invoice");
    window.scrollTo?.(0, 0);
  };

  const tabGroups = [
    {
      label: "Store admin",
      tabs: [
        { id: "dashboard", label: "Home", icon: "home" },
        { id: "sales", label: "All sales", icon: "bars", badge: needsAttention || 0 },
        { id: "filament", label: "Stock", icon: "box" },
        { id: "price-list", label: "Price list", icon: "list" },
        { id: "items", label: "Products", icon: "tag" },
        { id: "store-orders", label: "Orders", icon: "bag", badge: pendingOrders || 0 },
        { id: "settings", label: "Website", icon: "globe", badge: pendingReviewCount || 0 },
      ],
    },
    {
      label: "Invoicer",
      tabs: [
        { id: "history", label: "Invoices", icon: "receipt" },
        { id: "customers", label: "Customers", icon: "users" },
        { id: "payouts", label: "Payouts", icon: "card" },
        { id: "calculator", label: "Slice & price", icon: "calc" },
      ],
    },
  ];

  if (loading) {
    return (
      <div style={{ ...s.app, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div style={{ color: "#746A59" }}>Loading…</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{ ...s.app, maxWidth: 520, margin: "60px auto", textAlign: "center" }}>
        <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>Couldn't connect to Supabase</div>
        <div style={{ color: "#746A59", fontSize: 13.5, marginBottom: 12 }}>{loadError}</div>
        <div style={{ color: "#746A59", fontSize: 13 }}>
          Check that <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> are set in <code>.env</code>
          (or in your Vercel project's Environment Variables), and that the schema in{" "}
          <code>supabase/schema.sql</code> has been run. See the README.
        </div>
      </div>
    );
  }

  return (
    <div className={`shell${tab === "invoice" ? " is-invoice" : ""}`} style={s.app}>
      <Navigation tab={tab} groups={tabGroups} onGo={go} onSearch={() => go("search")} userEmail={userEmail} onSignOut={onSignOut} />

      <main className="app-main">
      <div className="app-body" style={s.body}>
        {tab === "dashboard" && (
          <AdminDashboard
            items={items}
            invoices={invoices}
            customers={customers}
            filaments={filaments}
            storeOrders={storeOrders}
            onNavigate={go}
            onStartInvoice={startInvoice}
          />
        )}
        {tab === "sales" && <Sales invoices={invoices} storeOrders={storeOrders} onOpen={setTab} />}
        {tab === "price-list" && <PriceList filaments={filaments} items={items} showToast={showToast} />}
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
            onAdd={handleAddFilament}
            onArchive={handleArchiveFilament}
            onRestore={handleRestoreFilament}
            loadRemoved={fetchArchivedFilaments}
            showToast={showToast}
          />
        )}
        {tab === "store-orders" && (
          <StoreOrders orders={storeOrders} onStatus={handleStoreOrderStatus} onTestSpool={handleTestSpool} showToast={showToast} />
        )}
        {tab === "invoice" && (
          <InvoiceBuilder
            key={editingInvoice?.id ?? `new-invoice-${prefill?.key ?? 0}`}
            items={items}
            customers={customers}
            filaments={filaments}
            invoiceNo={invoiceNo}
            invoices={invoices}
            prefill={prefill}
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
          <InvoiceHistory invoices={invoices} onEdit={handleEditInvoice} onUpdate={handleUpdateInvoice} onDelete={handleDeleteInvoice} onDuplicate={startInvoice} openId={openInvoiceId} onOpened={() => setOpenInvoiceId(null)} onRefresh={refreshInvoices} showToast={showToast} />
        )}
        {tab === "search" && (
          <SearchPage
            invoices={invoices}
            customers={customers}
            items={items}
            filaments={filaments}
            storeOrders={storeOrders}
            onOpenInvoice={openInvoice}
            onNewInvoice={startInvoice}
            onGo={go}
          />
        )}
        {tab === "more" && <MoreMenu groups={tabGroups} onGo={go} userEmail={userEmail} onSignOut={onSignOut} />}
        {tab === "payouts" && <PayoutLedger showToast={showToast} />}
        {tab === "settings" && (
          <WebsiteSettings filaments={filaments} items={items} />
        )}
      </div>
      </main>

      {toast && <div className="app-toast" style={s.toast}>{toast}</div>}
    </div>
  );
}

const s = {
  app: {
    minHeight: "100vh",
    background: "#FAF8F4",
    backgroundImage: "linear-gradient(#EFEAE0 1px, transparent 1px), linear-gradient(90deg, #EFEAE0 1px, transparent 1px)",
    backgroundSize: "28px 28px",
    color: "#1B2A3D",
  },
  body: { maxWidth: 1040, margin: "0 auto" },
  toast: { position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "#1B2A3D", color: "#fff", padding: "10px 18px", borderRadius: 30, fontSize: 13, fontWeight: 600, boxShadow: "0 6px 20px rgba(0,0,0,0.2)" },
};
