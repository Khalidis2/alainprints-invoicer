import { useMemo, useState } from "react";
import { AED } from "../lib/helpers";
import { displayStatus } from "../lib/invoiceMath";
import { Icon } from "./Navigation";

const norm = (value) => String(value || "").toLowerCase();
const LIMIT = 6;

// One search over everything: invoices, customers, website orders, stock and products.
export default function SearchPage({ invoices, customers, items, filaments, storeOrders, onOpenInvoice, onNewInvoice, onGo }) {
  const [query, setQuery] = useState("");
  const needle = norm(query).trim();

  const groups = useMemo(() => {
    const has = (...parts) => parts.some((part) => norm(part).includes(needle));
    if (!needle) {
      return [{
        title: "Latest invoices",
        rows: invoices.slice(0, 5).map((invoice) => invoiceRow(invoice, onOpenInvoice)),
      }];
    }
    return [
      {
        title: "Invoices",
        rows: invoices
          .filter((invoice) => has(`INV-${invoice.number}`, invoice.number, invoice.customer?.name, invoice.customer?.phone, ...(invoice.lines || []).map((line) => line.name)))
          .map((invoice) => invoiceRow(invoice, onOpenInvoice)),
      },
      {
        title: "Customers",
        rows: customers
          .filter((customer) => has(customer.name, customer.phone))
          .map((customer) => ({ key: customer.id || customer.name, title: customer.name, sub: customer.phone || "No phone", action: "New invoice", run: () => onNewInvoice({ customer: { name: customer.name, phone: customer.phone || "", email: "" } }) })),
      },
      {
        title: "Website orders",
        rows: storeOrders
          .filter((order) => has(order.reference, order.customer_name, order.mobile))
          .map((order) => ({ key: order.id, title: `${order.reference} · ${order.customer_name || "Customer"}`, sub: `${AED(order.total)} · ${order.status}`, action: "Open", run: () => onGo("store-orders") })),
      },
      {
        title: "Stock",
        rows: filaments
          .filter((filament) => has(filament.material, filament.color, filament.brand, filament.sku))
          .map((filament) => ({ key: filament.id, title: [filament.brand, filament.material, filament.color].filter(Boolean).join(" "), sub: `${Math.round(Number(filament.remainingG || 0))} g left · ${filament.stockStatus}`, action: "Open", run: () => onGo("filament") })),
      },
      {
        title: "Products",
        rows: items
          .filter((item) => has(item.name, item.category))
          .map((item) => ({ key: item.id, title: item.name, sub: `${item.category || "Custom"} · ${AED(item.price)}`, action: "Open", run: () => onGo("items") })),
      },
    ].filter((group) => group.rows.length > 0);
  }, [needle, invoices, customers, items, filaments, storeOrders, onOpenInvoice, onNewInvoice, onGo]);

  return (
    <section className="search-page">
      <h2>Search</h2>
      <div className="search-box">
        <Icon name="search" size={20} />
        <input
          autoFocus
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Invoice number, customer, phone, colour, product…"
          aria-label="Search everything"
        />
      </div>
      {needle && groups.length === 0 && <div className="search-empty">Nothing found for "{query}". Try a name, a phone number or an invoice number.</div>}
      {!needle && <div className="search-hint">Type to search invoices, customers, website orders, stock and products. On a computer, press Ctrl K from anywhere.</div>}
      {groups.map((group) => (
        <div key={group.title} className="search-group">
          <div className="search-title">{group.title}</div>
          <div className="search-list">
            {group.rows.slice(0, LIMIT).map((row) => (
              <button key={row.key} type="button" onClick={row.run}>
                <span>
                  <b>{row.title}</b>
                  <small>{row.sub}</small>
                </span>
                <em>{row.action}</em>
              </button>
            ))}
            {group.rows.length > LIMIT && <div className="search-more">{group.rows.length - LIMIT} more. Type more of the name to narrow it down.</div>}
          </div>
        </div>
      ))}
    </section>
  );
}

function invoiceRow(invoice, onOpenInvoice) {
  return {
    key: invoice.id,
    title: `INV-${invoice.number} · ${invoice.customer?.name || "Walk-in"}`,
    sub: `${invoice.date} · ${AED(invoice.total)} · ${displayStatus(invoice)}`,
    action: "Open",
    run: () => onOpenInvoice(invoice.id),
  };
}
