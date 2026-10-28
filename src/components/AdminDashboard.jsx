import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { AED } from "../lib/helpers";
import { Breakdown, buildEntries } from "./Sales";
import { Icon } from "./Navigation";
import {
  daysSince,
  hasWhatsAppNumber,
  monthKey,
  monthReport,
  previousMonthKey,
  receiptsOf,
  reminderText,
  remainingOf,
  waNumber,
} from "../lib/invoiceMath";

const aed0 = (value) => `AED ${Math.round(Number(value) || 0).toLocaleString("en-AE")}`;
const isoDay = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const spoolsLeft = (filament) => Math.floor(Number(filament.remainingG || 0) / Number(filament.spoolWeightG || 1000));
const filamentName = (filament) => [filament.brand, filament.material, filament.color].filter(Boolean).join(" ");

function TypeChart({ report }) {
  if (!report.rows.length) {
    return <div className="home-empty">No payments yet this month. Paid invoices and website orders will show here.</div>;
  }
  let from = 0;
  const stops = report.rows.map((row) => {
    const start = from;
    from += row.percent;
    return `${row.color} ${start}% ${from}%`;
  });
  return (
    <div className="type-chart">
      <div className="type-donut" style={{ background: `conic-gradient(${stops.join(", ")})` }} role="img" aria-label={`Paid this month ${aed0(report.total)}`}>
        <div><small>PAID</small><strong>{aed0(report.total)}</strong><span>{report.payments} payment{report.payments === 1 ? "" : "s"}</span></div>
      </div>
      <div className="type-stack" aria-hidden="true">
        {report.rows.map((row) => <i key={row.type} style={{ width: `${row.percent}%`, background: row.color }} />)}
      </div>
      <ul className="type-legend">
        {report.rows.map((row) => (
          <li key={row.type}>
            <span className="type-dot" style={{ background: row.color }} />
            <div>
              <div className="type-row"><b>{row.label}</b><b>{aed0(row.amount)}</b></div>
              <div className="type-bar"><i style={{ width: `${Math.max(2, row.percent)}%`, background: row.color }} /></div>
            </div>
            <em>{Math.round(row.percent)}%</em>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AdminDashboard({ items, invoices, customers, filaments, storeOrders, onNavigate, onStartInvoice }) {
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

  const now = new Date();
  const month = monthKey(now);
  const report = useMemo(() => monthReport({ invoices, storeOrders, items, month }), [invoices, storeOrders, items, month]);
  const lastReport = useMemo(() => monthReport({ invoices, storeOrders, items, month: previousMonthKey(now) }), [invoices, storeOrders, items, month]);
  const delta = lastReport.total > 0 ? Math.round(((report.total - lastReport.total) / lastReport.total) * 100) : null;

  const week = useMemo(() => {
    const since = isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6));
    let total = 0;
    let count = 0;
    for (const invoice of invoices) {
      for (const receipt of receiptsOf(invoice)) {
        if (String(receipt.date || "").slice(0, 10) >= since) { total += receipt.amount; count += 1; }
      }
    }
    for (const order of storeOrders) {
      if (order.payment_status === "paid" && String(order.created_at || "").slice(0, 10) >= since) { total += Number(order.total || 0); count += 1; }
    }
    return { total, count };
  }, [invoices, storeOrders, month]);

  const unpaid = useMemo(() => {
    const open = invoices.filter((invoice) => (invoice.status || "Unpaid") === "Unpaid");
    return { total: open.reduce((sum, invoice) => sum + remainingOf(invoice), 0), count: open.length, list: open };
  }, [invoices]);

  const pendingOrders = storeOrders.filter((order) => order.status === "pending");
  const lowStock = filaments.filter((filament) => filament.stockStatus === "available" && spoolsLeft(filament) < 1);

  const attention = useMemo(() => {
    const rows = [];
    [...unpaid.list]
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .slice(0, 4)
      .forEach((invoice) => {
        const age = daysSince(invoice.date);
        const canRemind = hasWhatsAppNumber(invoice.customer?.phone);
        rows.push({
          key: `inv-${invoice.id}`,
          color: "#B45309",
          title: <><b className="home-inv">INV-{invoice.number}</b> unpaid{age > 0 ? ` ${age} day${age === 1 ? "" : "s"}` : ""}</>,
          sub: `${invoice.customer?.name || "No name"} · ${AED(remainingOf(invoice))}`,
          action: canRemind ? "Remind" : "Open",
          good: canRemind,
          run: () => {
            if (canRemind) window.open(`https://wa.me/${waNumber(invoice.customer.phone)}?text=${encodeURIComponent(reminderText(invoice, AED))}`, "_blank", "noopener");
            else onNavigate("history");
          },
        });
      });
    lowStock.slice(0, 3).forEach((filament) => rows.push({
      key: `low-${filament.id}`,
      color: "#B91C1C",
      title: <>{filamentName(filament)} {Number(filament.remainingG) > 0 ? "is running low" : "is out of stock"}</>,
      sub: `${Math.round(Number(filament.remainingG || 0))} g left`,
      action: "Open stock",
      run: () => onNavigate("filament"),
    }));
    pendingOrders.slice(0, 3).forEach((order) => rows.push({
      key: `ord-${order.id}`,
      color: "#6D28D9",
      title: <>Store order {order.reference}</>,
      sub: `${order.customer_name || "Customer"} · ${AED(order.total)} · pending`,
      action: "Open",
      run: () => onNavigate("store-orders"),
    }));
    return rows;
  }, [unpaid.list, lowStock, pendingOrders]);

  const recentCustomers = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const invoice of invoices) {
      const name = String(invoice.customer?.name || "").trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push({ name, phone: invoice.customer?.phone || "", email: invoice.customer?.email || "" });
      if (out.length === 4) break;
    }
    return out;
  }, [invoices]);

  // Same numbers as the All sales tab: website orders and invoices together.
  const entries = useMemo(() => buildEntries(invoices, storeOrders), [invoices, storeOrders]);
  const waiting = entries.filter((entry) => entry.attention);
  const waitingTotal = waiting.reduce((sum, entry) => sum + (entry.owed ?? entry.total), 0);

  const topMax = Math.max(1, ...report.top.map((row) => row.amount));

  return (
    <section className="home">
      <div className="home-head">
        <div>
          <span className="home-eyebrow">{now.toLocaleDateString("en-AE", { weekday: "long", day: "numeric", month: "long" }).toUpperCase()}</span>
          <h1>Business overview</h1>
        </div>
        <a className="home-site" href="https://www.printtools3d.com" target="_blank" rel="noreferrer">Open live website ↗</a>
      </div>

      <div className="home-actions">
        <button type="button" className="home-main-btn" onClick={() => onNavigate("invoice", { fresh: true })}><Icon name="plus" size={18} />New invoice</button>
        <button type="button" className="home-alt-btn" onClick={() => onNavigate("filament")}><Icon name="box" size={18} />Stock</button>
        <button type="button" className="home-alt-btn" onClick={() => onNavigate("customers")}><Icon name="users" size={18} />Customers</button>
      </div>

      <div className="home-cards">
        <button type="button" className="home-card is-navy" onClick={() => onNavigate("sales")}>
          <small>THIS MONTH</small>
          <strong>{aed0(report.total)}</strong>
          <span>{delta === null ? "First month with payments" : `${delta >= 0 ? "+" : ""}${delta}% vs last month`}</span>
        </button>
        <button type="button" className="home-card" onClick={() => onNavigate("history")}>
          <small>UNPAID</small>
          <strong style={{ color: "#B45309" }}>{aed0(unpaid.total)}</strong>
          <span>{unpaid.count} invoice{unpaid.count === 1 ? "" : "s"}</span>
        </button>
        <button type="button" className="home-card" onClick={() => onNavigate("sales")}>
          <small>PAID THIS WEEK</small>
          <strong style={{ color: "#047857" }}>{aed0(week.total)}</strong>
          <span>{week.count} payment{week.count === 1 ? "" : "s"}</span>
        </button>
        <button type="button" className="home-card" onClick={() => onNavigate("store-orders")}>
          <small>WEBSITE ORDERS</small>
          <strong>{pendingOrders.length} pending</strong>
          <span>{storeOrders.length} order{storeOrders.length === 1 ? "" : "s"} in total</span>
        </button>
        <button type="button" className="home-card" onClick={() => onNavigate("filament")}>
          <small>LOW STOCK</small>
          <strong style={lowStock.length ? { color: "#B91C1C" } : undefined}>{lowStock.length} spool{lowStock.length === 1 ? "" : "s"}</strong>
          <span>{lowStock.length ? lowStock.slice(0, 2).map((f) => [f.material, f.color].filter(Boolean).join(" ")).join(", ") : "All colours in stock"}</span>
        </button>
      </div>

      <div className="home-grid">
        <div className="home-panel">
          <div className="home-panel-title">Payments this month, by item type</div>
          <TypeChart report={report} />
        </div>

        <div className="home-panel">
          <div className="home-panel-title">Needs attention</div>
          {attention.length === 0 ? (
            <div className="home-empty">All clear. Nothing unpaid, low or waiting.</div>
          ) : (
            <ul className="attn">
              {attention.map((row) => (
                <li key={row.key}>
                  <span className="attn-bar" style={{ background: row.color }} />
                  <div>
                    <div className="attn-title">{row.title}</div>
                    <div className="attn-sub">{row.sub}</div>
                  </div>
                  <button type="button" className={row.good ? "is-good" : undefined} onClick={row.run}>{row.action}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="home-grid">
        <div className="home-panel">
          <div className="home-panel-title">Top sellers this month</div>
          {report.top.length === 0 ? (
            <div className="home-empty">Best sellers appear after the first payment this month.</div>
          ) : (
            <div className="top-list">
              {report.top.map((row) => (
                <div key={row.name}>
                  <div className="top-row"><span>{row.name}</span><b>{aed0(row.amount)}</b></div>
                  <div className="type-bar"><i style={{ width: `${(row.amount / topMax) * 100}%`, background: "#16324F" }} /></div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="home-panel">
          <div className="home-panel-title">Recent customers</div>
          {recentCustomers.length === 0 ? (
            <div className="home-empty">Customers you invoice will appear here for one-tap new invoices.</div>
          ) : (
            <div className="recent-list">
              {recentCustomers.map((customer) => (
                <button key={customer.name} type="button" onClick={() => onStartInvoice({ customer })}>
                  <b>{customer.name}</b>
                  <span>New invoice</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <details className="home-fees">
        <summary>After Stripe fees: what you keep{held === null ? "" : ` · ${AED(held)} held for you`}</summary>
        <Breakdown entries={entries} waiting={waiting} waitingTotal={waitingTotal} />
      </details>
    </section>
  );
}
