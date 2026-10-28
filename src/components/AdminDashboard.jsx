import { useEffect, useMemo, useState } from "react";
import { fetchComingPayouts } from "../lib/storage";
import { Breakdown, buildEntries } from "./Sales";

function money(value) {
  return new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED" }).format(Number(value || 0));
}

const DAY = 86400000;
const dayLabel = (time) => new Date(time).toLocaleDateString("en-AE", { day: "numeric", month: "short" });
// Invoice dates are plain YYYY-MM-DD strings; show them like the payment dates ("16 Sep").
const dateLabel = (value) => (value ? dayLabel(new Date(`${value}T00:00:00`).getTime()) : "No date");

// Money that actually came in, newest first. Uses the day it was paid, not the day it was created.
function buildPayments(invoices, storeOrders) {
  const fromInvoices = invoices.filter((invoice) => invoice.status === "Paid").map((invoice) => ({
    key: `inv-${invoice.id}`,
    when: new Date(invoice.paidDate || invoice.date || 0).getTime() || 0,
    name: invoice.customer?.name || "No name",
    ref: `INV-${invoice.number}`,
    amount: Number(invoice.total) || 0,
  }));
  const fromOrders = storeOrders.filter((order) => order.payment_status === "paid").map((order) => ({
    key: `ord-${order.id}`,
    when: new Date(order.paid_at || order.created_at || 0).getTime() || 0,
    name: order.customer_name || "Website order",
    ref: order.reference,
    amount: Number(order.total) || 0,
  }));
  return [...fromInvoices, ...fromOrders].sort((a, b) => b.when - a.when);
}

// Future payouts: card money Stripe holds for you plus payouts already sent but not yet in your bank.
function ComingPayouts() {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let alive = true;
    fetchComingPayouts()
      .then((result) => alive && setState({ loading: false, ...result }))
      .catch(() => alive && setState({ loading: false, failed: true }));
    return () => { alive = false; };
  }, []);

  const transit = (state.inTransit || []).reduce((sum, row) => sum + row.amount, 0);
  const total = (state.inStripe || 0) + transit;
  return (
    <article className="admin-card dash-wide dash-coming">
      <span>Future payouts</span>
      {state.loading && <p className="dash-empty">Checking Stripe…</p>}
      {state.failed && <p className="dash-empty">Couldn't load payouts right now.</p>}
      {!state.loading && !state.failed && (
        <>
          <strong className="dash-total-inline">{money(total)}</strong>
          <p className="dash-empty">Paid by customers in Stripe, not in your bank yet.</p>
          {state.inStripe === null && <p className="dash-empty">Stripe balance unavailable, so this only counts payouts already sent. Give the Stripe key Balance: Read.</p>}
        </>
      )}
    </article>
  );
}

function DashboardCards({ invoices, storeOrders, filaments, onNavigate }) {
  const payments = useMemo(() => buildPayments(invoices, storeOrders), [invoices, storeOrders]);
  const now = Date.now();
  const sumSince = (days) => payments.filter((payment) => payment.when >= now - days * DAY).reduce((sum, payment) => sum + payment.amount, 0);
  const allTime = payments.reduce((sum, payment) => sum + payment.amount, 0);

  const unpaid = useMemo(
    () => invoices.filter((invoice) => (invoice.status || "Unpaid") === "Unpaid").sort((a, b) => String(a.date).localeCompare(String(b.date))),
    [invoices],
  );
  const owed = unpaid.reduce((sum, invoice) => sum + (Number(invoice.total) || 0), 0);

  // Less than one full spool left of a colour you sell.
  const low = useMemo(
    () => filaments
      .filter((item) => item.stockStatus === "available" && Number(item.remainingG || 0) < Number(item.spoolWeightG || 1000))
      .sort((a, b) => Number(a.remainingG || 0) - Number(b.remainingG || 0)),
    [filaments],
  );

  return (
    <div className="dash-cards">
      <ComingPayouts />
      <article className="admin-card dash-wide">
        <span>Money received</span>
        <div className="dash-stats">
          <div><small>Last 7 days</small><strong>{money(sumSince(7))}</strong></div>
          <div><small>Last 30 days</small><strong>{money(sumSince(30))}</strong></div>
          <div><small>All time</small><strong>{money(allTime)}</strong></div>
        </div>
      </article>

      <article className="admin-card">
        <span>Recent payments</span>
        {payments.length === 0 && <p className="dash-empty">No payments yet.</p>}
        <ul className="dash-list">
          {payments.slice(0, 6).map((payment) => (
            <li key={payment.key}><b>{payment.name}</b><small>{dayLabel(payment.when)} · {payment.ref}</small><strong>{money(payment.amount)}</strong></li>
          ))}
        </ul>
      </article>

      <article className="admin-card">
        <span>Waiting to be paid</span>
        <strong className="dash-total">{money(owed)}</strong>
        {unpaid.length === 0 && <p className="dash-empty">Nothing unpaid.</p>}
        <ul className="dash-list">
          {unpaid.slice(0, 4).map((invoice) => (
            <li key={invoice.id}><b>{invoice.customer?.name || "No name"}</b><small>{dateLabel(invoice.date)} · INV-{invoice.number}</small><strong>{money(invoice.total)}</strong></li>
          ))}
        </ul>
        {unpaid.length > 4 && <button type="button" className="dash-link" onClick={() => onNavigate("history")}>All {unpaid.length} unpaid →</button>}
      </article>

      <article className="admin-card">
        <span>Low filament</span>
        {low.length === 0 && <p className="dash-empty">Every colour has a full spool.</p>}
        <ul className="dash-list">
          {low.slice(0, 6).map((item) => (
            <li key={item.id}><b>{`${item.material} ${item.color}`.trim()}</b><small>{Math.round(Number(item.remainingG || 0))} g left</small><strong>{Number(item.remainingG || 0) <= 0 ? "Out" : "Low"}</strong></li>
          ))}
        </ul>
        <button type="button" className="dash-link" onClick={() => onNavigate("filament")}>{low.length > 6 ? `All ${low.length} low · ` : ""}Manage stock →</button>
      </article>
    </div>
  );
}

export default function AdminDashboard({ items, invoices, customers, filaments, storeOrders, onNavigate }) {
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

  const sections = [
    { id: "filament", title: "Filament stock", value: `${metrics.fullSpools} spools`, text: "Update quantities, prices and incoming stock. Changes feed the PrintTools3D Store.", action: "Manage stock" },
    { id: "items", title: "Printed products", value: `${items.length} products`, text: "Add printed parts, photos and your own selling prices.", action: "Manage products" },
    { id: "store-orders", title: "Store orders", value: `${metrics.pendingOrders} pending`, text: "Review customer orders and update their fulfilment status.", action: "Open orders" },
    { id: "customers", title: "Customers", value: `${customers.length} customers`, text: "Maintain customer contact details and order history.", action: "View customers" },
    { id: "history", title: "Invoices", value: `${invoices.length} invoices`, text: "Create, edit, print and share invoices, and track unpaid ones.", action: "View invoices" },
  ];

  return (
    <section>
      <div className="admin-hero">
        <div>
          <span className="admin-eyebrow">PRINTTOOLS3D ADMIN</span>
          <h1>Business control centre</h1>
          <p>Manage the information used by your store and invoicing workflow from one protected place.</p>
        </div>
        <div className="admin-hero-links">
          <a className="admin-site-link" href="https://www.printtools3d.com" target="_blank" rel="noreferrer">Open live website ↗</a>
          <button type="button" className="admin-site-link" onClick={() => onNavigate("settings")}>Website settings</button>
        </div>
      </div>

      <DashboardCards invoices={invoices} storeOrders={storeOrders} filaments={filaments} onNavigate={onNavigate} />

      <div className="dash-section-row">
        <span>What you keep</span>
        <button type="button" className="dash-link" onClick={() => onNavigate("sales")}>Open all sales →</button>
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
