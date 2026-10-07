import { useMemo } from "react";
import { FeeSummary } from "./StripeFees";

function money(value) {
  return new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED" }).format(Number(value || 0));
}

export default function AdminDashboard({ items, invoices, customers, filaments, storeOrders, onNavigate }) {
  const metrics = useMemo(() => {
    const available = filaments.filter((item) => item.stockStatus === "available");
    const fullSpools = available.reduce((sum, item) => {
      const spoolWeight = Number(item.spoolWeightG || 1000);
      return sum + Math.floor(Number(item.remainingG || 0) / spoolWeight);
    }, 0);
    const paidRevenue = invoices
      .filter((invoice) => invoice.status === "Paid")
      .reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
    const pendingOrders = storeOrders.filter((order) => order.status === "pending").length;
    return { fullSpools, paidRevenue, pendingOrders };
  }, [filaments, invoices, storeOrders]);

  // Every card payment Stripe has confirmed: website orders and invoices paid by link.
  const cardPayments = useMemo(() => [
    ...invoices.filter((invoice) => invoice.status === "Paid" && invoice.stripePaymentIntent).map((invoice) => ({ paymentIntent: invoice.stripePaymentIntent })),
    ...storeOrders.filter((order) => order.payment_status === "paid" && order.stripe_payment_intent).map((order) => ({ paymentIntent: order.stripe_payment_intent })),
  ], [invoices, storeOrders]);

  const sections = [
    { id: "filament", title: "Filament stock", value: `${metrics.fullSpools} spools`, text: "Update quantities, prices and incoming stock. Changes feed the PrintTools3D Store.", action: "Manage stock" },
    { id: "items", title: "Printed products", value: `${items.length} products`, text: "Add printed parts, photos and your own selling prices.", action: "Manage products" },
    { id: "store-orders", title: "Store orders", value: `${metrics.pendingOrders} pending`, text: "Review customer orders and update their fulfilment status.", action: "Open orders" },
    { id: "customers", title: "Customers", value: `${customers.length} customers`, text: "Maintain customer contact details and order history.", action: "View customers" },
    { id: "history", title: "Invoices & revenue", value: money(metrics.paidRevenue), text: "Track paid and unpaid invoices and review revenue.", action: "View invoices" },
    { id: "settings", title: "Website", value: "Live", text: "Open PrintTools3D and review what is synchronized from this admin.", action: "Website settings" },
  ];

  return (
    <section>
      <div className="admin-hero">
        <div>
          <span className="admin-eyebrow">PRINTTOOLS3D ADMIN</span>
          <h1>Business control centre</h1>
          <p>Manage the information used by your store and invoicing workflow from one protected place.</p>
        </div>
        <a className="admin-site-link" href="https://www.printtools3d.com" target="_blank" rel="noreferrer">Open live website ↗</a>
      </div>

      <FeeSummary label="Card payments: received after Stripe fees" payments={cardPayments} />

      <div className="admin-grid">
        {sections.map((section) => (
          <article className="admin-card" key={section.id}>
            <span>{section.title}</span>
            <strong>{section.value}</strong>
            <p>{section.text}</p>
            <button type="button" onClick={() => onNavigate(section.id)}>{section.action} →</button>
          </article>
        ))}
      </div>
    </section>
  );
}
