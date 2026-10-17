import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { Breakdown, buildEntries } from "./Sales";

function money(value) {
  return new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED" }).format(Number(value || 0));
}

export default function AdminDashboard({ items, invoices, customers, filaments, storeOrders, onNavigate }) {
  // Money he still holds for you: payouts sent minus what he bought or gave back (see the Payouts tab).
  const [held, setHeld] = useState(null);
  useEffect(() => {
    let alive = true;
    supabase.from("payout_ledger").select("kind,amount,status").then(({ data, error }) => {
      if (!alive || error || !data) return;
      const total = data.filter((row) => row.status === "done").reduce((sum, row) => sum + (row.kind === "payout" ? Number(row.amount) : -Number(row.amount)), 0);
      setHeld(total);
    });
    return () => { alive = false; };
  }, []);

  const metrics = useMemo(() => {
    const available = filaments.filter((item) => item.stockStatus === "available");
    const fullSpools = available.reduce((sum, item) => {
      const spoolWeight = Number(item.spoolWeightG || 1000);
      return sum + Math.floor(Number(item.remainingG || 0) / spoolWeight);
    }, 0);
    const pendingOrders = storeOrders.filter((order) => order.status === "pending").length;
    return { fullSpools, pendingOrders };
  }, [filaments, invoices, storeOrders]);

  // Same numbers as the All sales tab: website orders and invoices together.
  const entries = useMemo(() => buildEntries(invoices, storeOrders), [invoices, storeOrders]);
  const waiting = entries.filter((entry) => entry.attention);
  const waitingTotal = waiting.reduce((sum, entry) => sum + entry.total, 0);
  const paidAll = entries.filter((entry) => entry.paid).reduce((sum, entry) => sum + entry.total, 0);

  const sections = [
    { id: "filament", title: "Filament stock", value: `${metrics.fullSpools} spools`, text: "Update quantities, prices and incoming stock. Changes feed the Alain Prints store.", action: "Manage stock" },
    { id: "items", title: "Printed products", value: `${items.length} products`, text: "Add printed parts, photos and your own selling prices.", action: "Manage products" },
    { id: "store-orders", title: "Store orders", value: `${metrics.pendingOrders} pending`, text: "Review customer orders and update their fulfilment status.", action: "Open orders" },
    { id: "customers", title: "Customers", value: `${customers.length} customers`, text: "Maintain customer contact details and order history.", action: "View customers" },
    { id: "sales", title: "All sales", value: money(paidAll), text: "Total paid by customers, website orders and invoices together. Open it to see what you keep after fees.", action: "Open all sales" },
    { id: "payouts", title: "Payouts", value: held === null ? "Open" : `${money(held)} held`, text: "Stripe payouts sent to his bank, minus what he bought or gave back. Shows what he still holds for you.", action: "Open payouts" },
    { id: "history", title: "Invoices", value: `${invoices.length} invoices`, text: "Create, edit, print and share invoices, and track unpaid ones.", action: "View invoices" },
    { id: "settings", title: "Website", value: "Live", text: "Open the Alain Prints website and review what is synchronized from this admin.", action: "Website settings" },
  ];

  return (
    <section>
      <div className="admin-hero">
        <div>
          <span className="admin-eyebrow">ALAIN PRINTS ADMIN</span>
          <h1>Business control centre</h1>
          <p>Manage the information used by your store and invoicing workflow from one protected place.</p>
        </div>
        <a className="admin-site-link" href="https://www.printtools3d.com" target="_blank" rel="noreferrer">Open live website ↗</a>
      </div>

      <Breakdown entries={entries} waiting={waiting} waitingTotal={waitingTotal} />

      <div className="admin-grid">
        {sections.map((section) => (
          <button type="button" className="admin-card admin-tile" key={section.id} title={section.text} onClick={() => onNavigate(section.id)}>
            <span>{section.title}</span>
            <strong>{section.value}</strong>
            <em>{section.action} →</em>
          </button>
        ))}
      </div>
    </section>
  );
}
