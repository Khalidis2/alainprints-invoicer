import { useEffect, useMemo, useRef, useState } from "react";
import { AED, today } from "../lib/helpers";
import InvoicePrint from "./InvoicePrint";
import { checkStripePayment, matchStripePayments, syncStripeRefunds } from "../lib/storage";
import { FeeLine, FeeSummary } from "./StripeFees";
import InvoiceDetail from "./InvoiceDetail";
import { displayStatus, isPartPaid, receivedSoFar, remainingOf } from "../lib/invoiceMath";

const STATUSES = ["Draft", "Unpaid", "Paid", "Refunded", "Cancelled"];
const STATUS_COLOR = {
  Draft: "#6B7280",
  Unpaid: "#B45309",
  "Part paid": "#B45309",
  Paid: "#047857",
  Refunded: "#6D28D9",
  Cancelled: "#B91C1C",
};
const STATUS_BG = {
  Draft: "#F3F4F6",
  Unpaid: "#FFF7ED",
  "Part paid": "#FFF7ED",
  Paid: "#ECFDF5",
  Refunded: "#F5F3FF",
  Cancelled: "#FEF2F2",
};

export default function InvoiceHistory({ invoices, onEdit, onUpdate, onDelete, onDuplicate, openId, onOpened, onRefresh, showToast }) {
  const [open, setOpen] = useState(null);
  // The invoice opened from the list: shows what is still owed, reminders, payments and history.
  const [detailId, setDetailId] = useState(null);
  useEffect(() => {
    if (!openId) return;
    setDetailId(openId);
    onOpened?.();
  }, [openId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [autoPrint, setAutoPrint] = useState(false);
  const [autoShare, setAutoShare] = useState(false);
  const [workingId, setWorkingId] = useState(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  // Backup for the Stripe webhook: when this tab opens, quietly ask Stripe about unpaid invoices that have a link.
  const refundsChecked = useRef(false);
  useEffect(() => {
    if (refundsChecked.current || !invoices.some((invoice) => invoice.stripeLinkId)) return;
    refundsChecked.current = true;
    syncStripeRefunds()
      .then((result) => {
        if (result.changed) {
          showToast(`${result.changed} Stripe refund${result.changed === 1 ? "" : "s"} found: invoice updated, spools back in stock`);
          onRefresh?.();
        }
      })
      .catch(() => {});
  }, [invoices, onRefresh, showToast]);

  // Older card invoices were saved without Stripe's payment id, so their fee could not be read.
  // Once per visit, attach the id (only the id) so every paid card invoice shows its exact Stripe fee.
  const matchedOnce = useRef(false);
  const [unlinked, setUnlinked] = useState([]);
  useEffect(() => {
    if (matchedOnce.current) return;
    const needs = invoices.some((invoice) => invoice.status === "Paid" && !invoice.stripePaymentIntent && (invoice.stripeLinkId || /stripe|card/i.test(invoice.paymentMethod || "")));
    if (!needs) return;
    matchedOnce.current = true;
    matchStripePayments()
      .then((result) => {
        setUnlinked(result.unmatched || []);
        if (result.matched) {
          showToast(`${result.matched} paid invoice${result.matched === 1 ? "" : "s"} matched to Stripe: exact fees now shown`);
          onRefresh?.();
        }
      })
      .catch(() => {});
  }, [invoices, onRefresh, showToast]);

  // Owner-supplied list: "these invoices were paid by Stripe link". Finds each payment in Stripe by amount and date.
  const [manualList, setManualList] = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  const [manualResult, setManualResult] = useState("");
  const linkManual = async () => {
    // Accepts "1001, 1005" (match by amount and date) and "1008=pi_..." (exact payment id), one per line or comma separated.
    const pairs = {};
    for (const match of manualList.matchAll(/(?:INV-)?(\d{3,6})\s*[=:]\s*(pi_[A-Za-z0-9]+)/gi)) pairs[match[1]] = match[2];
    const numbers = [...new Set(manualList.replace(/(?:INV-)?\d{3,6}\s*[=:]\s*pi_[A-Za-z0-9]+/gi, " ").split(/[^0-9]+/).filter(Boolean))];
    if (!numbers.length && !Object.keys(pairs).length) return;
    setManualBusy(true);
    setManualResult("");
    try {
      const result = await matchStripePayments(numbers, pairs);
      const parts = [];
      if (result.matched) parts.push(`${result.matched} linked to Stripe: ${result.details.map((d) => `INV-${d.number}`).join(", ")}`);
      if (result.unmatched?.length) parts.push(`No single matching Stripe payment found for ${result.unmatched.map((n) => `INV-${n}`).join(", ")}`);
      for (const item of result.mismatched || []) parts.push(`INV-${item.number} not linked: ${item.reason}`);
      if (result.notPaid?.length) parts.push(`Skipped (not Paid, or already linked): ${result.notPaid.map((n) => `INV-${n}`).join(", ")}`);
      setManualResult(parts.join(". ") + ".");
      if (result.matched) onRefresh?.();
    } catch (error) {
      setManualResult(error.message || "Could not reach Stripe.");
    } finally {
      setManualBusy(false);
    }
  };

  const checkedOnce = useRef(false);
  useEffect(() => {
    if (checkedOnce.current) return;
    const waiting = invoices.filter((invoice) => (invoice.status || "Unpaid") === "Unpaid" && invoice.stripeLinkId).slice(0, 10);
    if (!waiting.length) return;
    checkedOnce.current = true;
    Promise.all(waiting.map((invoice) => checkStripePayment(invoice.id).catch(() => ({ paid: false }))))
      .then((results) => {
        const paid = results.filter((result) => result.paid && !result.already).length;
        if (paid) {
          showToast(`${paid} Stripe payment${paid === 1 ? "" : "s"} found: marked Paid`);
          onRefresh?.();
        }
      });
  }, [invoices, onRefresh, showToast]);

  const totals = useMemo(() => {
    const billable = invoices.filter((invoice) => ["Paid", "Unpaid"].includes(invoice.status || "Unpaid"));
    const paid = billable.reduce((sum, invoice) => sum + receivedSoFar(invoice), 0);
    const unpaid = billable.reduce((sum, invoice) => sum + remainingOf(invoice), 0);
    return { billed: paid + unpaid, paid, unpaid, count: billable.length };
  }, [invoices]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return invoices.filter((invoice) => {
      const status = invoice.status || "Unpaid";
      const matchesStatus = statusFilter === "All" || status === statusFilter;
      const searchable = `INV-${invoice.number} ${invoice.customer.name || ""} ${invoice.customer.phone || ""}`.toLowerCase();
      return matchesStatus && (!needle || searchable.includes(needle));
    });
  }, [invoices, query, statusFilter]);

  if (open) {
    return (
      <InvoicePrint
        invoice={open}
        autoPrint={autoPrint}
        autoShare={autoShare}
        onBack={() => {
          setOpen(null);
          setAutoPrint(false);
          setAutoShare(false);
        }}
        backLabel="Back to history"
      />
    );
  }

  const updateStatus = async (invoice, nextStatus) => {
    const currentStatus = invoice.status || "Unpaid";
    if (nextStatus === currentStatus || ["Cancelled", "Refunded"].includes(currentStatus)) return;
    if (nextStatus === "Refunded" && !window.confirm(`Mark INV-${invoice.number} as refunded? Any spools on it go back into stock. Refund the money in Stripe yourself if it was paid by card.`)) return;
    if (nextStatus === "Cancelled" && !window.confirm(`Cancel invoice INV-${invoice.number}? It will remain permanently in history.`)) return;
    setWorkingId(invoice.id);
    try {
      await onUpdate({
        ...invoice,
        status: nextStatus,
        paidDate: nextStatus === "Paid" ? (invoice.paidDate || today()) : invoice.paidDate,
        paymentMethod: nextStatus === "Paid" ? (invoice.paymentMethod || "") : invoice.paymentMethod,
      });
      showToast(`Invoice INV-${invoice.number} marked ${nextStatus}`);
    } catch {
      showToast("Couldn't update status - check connection");
    } finally {
      setWorkingId(null);
    }
  };

  const remove = async (invoice) => {
    if ((invoice.status || "Unpaid") !== "Draft") return;
    if (!window.confirm(`Delete draft INV-${invoice.number}? This can't be undone.`)) return;
    setWorkingId(invoice.id);
    try {
      await onDelete(invoice.id);
      showToast("Draft deleted");
    } catch {
      showToast("Couldn't delete draft - check connection");
    } finally {
      setWorkingId(null);
    }
  };

  const detailInvoice = detailId ? invoices.find((invoice) => invoice.id === detailId) : null;
  if (detailInvoice) {
    return (
      <InvoiceDetail
        invoice={detailInvoice}
        onBack={() => setDetailId(null)}
        onUpdate={onUpdate}
        onEdit={() => onEdit(detailInvoice)}
        onDuplicate={() => onDuplicate?.({ customer: { ...detailInvoice.customer }, lines: (detailInvoice.lines || []).map((line) => ({ ...line })), notes: detailInvoice.notes || "" })}
        onPrint={() => { setAutoShare(false); setAutoPrint(true); setOpen(detailInvoice); }}
        onShare={() => { setAutoPrint(false); setAutoShare(true); setOpen(detailInvoice); }}
        onStatus={(next) => updateStatus(detailInvoice, next)}
        onDelete={async () => { await remove(detailInvoice); setDetailId(null); }}
        onRefresh={onRefresh}
        showToast={showToast}
      />
    );
  }

  return (
    <div>
      <div style={s.headingRow}>
        <div>
          <h2 style={s.h2}>Invoice history</h2>
          <div style={s.sub}>{invoices.length} invoice{invoices.length !== 1 ? "s" : ""} saved</div>
        </div>
      </div>

      <FeeSummary label="Paid by card (Stripe)" payments={invoices.filter((invoice) => invoice.status === "Paid" && invoice.stripePaymentIntent).map((invoice) => ({ paymentIntent: invoice.stripePaymentIntent }))} />

      <details style={{ margin: "0 0 12px", padding: "10px 12px", border: "1px solid #E4DFD3", borderRadius: 9, background: "#fff" }}>
        <summary style={{ cursor: "pointer", fontWeight: 800, color: "#16324F", minHeight: 28 }}>Link invoices paid by Stripe link</summary>
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          <small style={{ color: "#6B6355", lineHeight: 1.5 }}>Type invoice numbers paid through a Stripe link (1001, 1005) to match them by amount and date, or paste exact pairs like 1008=pi_abc123 (one per line). Each is checked against Stripe first. Only the payment id is saved.</small>
          <textarea rows="3" value={manualList} onChange={(event) => setManualList(event.target.value)} placeholder="1001, 1005  or  1008=pi_abc123" style={{ border: "1px solid #DCD5C6", borderRadius: 8, padding: "10px 12px" }} />
          <button type="button" disabled={manualBusy || !manualList.trim()} onClick={linkManual} style={{ minHeight: 44, border: 0, borderRadius: 8, background: "#16324F", color: "#fff", fontWeight: 800 }}>{manualBusy ? "Matching…" : "Match to Stripe"}</button>
          {manualResult && <div role="status" style={{ color: "#16324F", fontSize: 13, lineHeight: 1.5 }}>{manualResult}</div>}
        </div>
      </details>

      {unlinked.length > 0 && (
        <div style={{ margin: "0 0 12px", padding: "10px 12px", border: "1px solid #E4DFD3", borderRadius: 9, background: "#FFF7ED", color: "#92400E", fontSize: 13, lineHeight: 1.5 }}>
          No Stripe payment could be found for invoice{unlinked.length === 1 ? "" : "s"} {unlinked.map((n) => `INV-${n}`).join(", ")}. If {unlinked.length === 1 ? "it was" : "they were"} paid by card, the fee cannot be calculated until the payment is linked in Stripe.
        </div>
      )}

      <div className="history-summary" style={s.summaryGrid}>
        <SummaryCard label="Total billed" value={AED(totals.billed)} accent="#16324F" />
        <SummaryCard label="Paid" value={AED(totals.paid)} accent="#047857" />
        <SummaryCard label="Outstanding" value={AED(totals.unpaid)} accent="#B45309" />
        <SummaryCard label="Active invoices" value={String(totals.count)} accent="#2E7D8C" />
      </div>

      <div className="history-toolbar" style={s.toolbar}>
        <input
          style={s.search}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search invoice, customer or phone"
          aria-label="Search invoices"
        />
        <select style={s.filter} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option>All</option>
          {STATUSES.map((status) => <option key={status}>{status}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div style={s.empty}>No invoices match this search or filter.</div>
      ) : (
        <div style={s.list}>
          {filtered.map((invoice) => {
            const status = invoice.status || "Unpaid";
            const busy = workingId === invoice.id;

            return (
              <div key={invoice.id} className="history-row" style={s.row}>
                <button className="history-main" style={s.rowMain} onClick={() => setDetailId(invoice.id)}>
                  <span style={s.no}>INV-{invoice.number}</span>
                  <span style={s.name}>{invoice.customer.name || "Walk-in"}</span>
                  <span style={s.date}>{invoice.date}</span>
                  <span style={s.total}>{AED(invoice.total)}</span>
                </button>

                <span style={{ ...s.statusPill, color: STATUS_COLOR[displayStatus(invoice)] || STATUS_COLOR[status], background: STATUS_BG[displayStatus(invoice)] || STATUS_BG[status] }}>{displayStatus(invoice).toUpperCase()}</span>
                {status === "Unpaid" && <button style={s.paidBtn} disabled={busy} onClick={() => updateStatus(invoice, "Paid")}>Mark paid</button>}
                {isPartPaid(invoice) && (
                  <div className="payment-summary" style={{ ...s.paymentSummary, color: "#B45309" }}>
                    Part paid: {AED(receivedSoFar(invoice))} received · {AED(remainingOf(invoice))} left
                  </div>
                )}
                {status === "Paid" && (
                  <div className="payment-summary" style={s.paymentSummary}>
                    Paid {invoice.paidDate || "date not recorded"}{invoice.paymentMethod ? ` · ${invoice.paymentMethod}` : ""}{invoice.paymentReference ? ` · Ref: ${invoice.paymentReference}` : ""}
                    {invoice.stripePaymentIntent ? <FeeLine paymentIntent={invoice.stripePaymentIntent} total={Number(invoice.total)} /> : null}
                  </div>
                )}
                {status === "Refunded" && (
                  <div className="payment-summary" style={{ ...s.paymentSummary, color: "#6D28D9" }}>
                    Refunded {invoice.refundedDate || ""}{invoice.stripeRefundedAmount ? ` · ${AED(invoice.stripeRefundedAmount / 100)}` : ""} · spools returned to stock
                  </div>
                )}
                {status === "Paid" && invoice.stripeRefundedAmount > 0 && (
                  <div className="payment-summary" style={{ ...s.paymentSummary, color: "#6D28D9" }}>
                    Partly refunded in Stripe: {AED(invoice.stripeRefundedAmount / 100)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, accent }) {
  return (
    <div style={s.card}>
      <div style={s.cardLabel}>{label}</div>
      <div style={{ ...s.cardValue, color: accent }}>{value}</div>
    </div>
  );
}

const s = {
  headingRow: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 },
  h2: { fontSize: 26, fontWeight: 850, margin: 0, color: "#16324F" },
  sub: { fontSize: 13, color: "#746A59", marginTop: 4 },
  summaryGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, margin: "18px 0" },
  card: { background: "#fff", border: "1px solid #E4DFD3", borderRadius: 12, padding: "15px 16px" },
  cardLabel: { color: "#746A59", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.7 },
  cardValue: { marginTop: 6, fontSize: 20, fontWeight: 850 },
  toolbar: { display: "grid", gridTemplateColumns: "minmax(220px, 1fr) 160px", gap: 10, marginBottom: 14 },
  search: { width: "100%", padding: "10px 12px", border: "1px solid #DCD5C6", borderRadius: 9, background: "#fff", color: "#1B2A3D", fontSize: 13.5 },
  filter: { width: "100%", padding: "10px 12px", border: "1px solid #DCD5C6", borderRadius: 9, background: "#fff", color: "#1B2A3D", fontSize: 13.5, fontWeight: 700 },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  empty: { padding: "30px 16px", textAlign: "center", color: "#746A59", fontSize: 13.5, border: "1.5px dashed #DCD5C6", borderRadius: 12, background: "#fff" },
  row: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, background: "#fff", border: "1px solid #E4DFD3", borderRadius: 10, padding: "11px 13px", boxShadow: "0 1px 2px rgba(27,42,61,.03)" },
  rowMain: { flex: 1, minWidth: 0, display: "grid", gridTemplateColumns: "90px minmax(120px,1fr) 95px 100px", gap: 10, alignItems: "center", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", fontSize: 13 },
  no: { color: "#B9531A", fontWeight: 800 },
  name: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 700, color: "#1B2A3D" },
  date: { color: "#746A59", fontSize: 12 },
  total: { fontWeight: 800, textAlign: "right", color: "#1B2A3D" },
  statusPill: { flex: "0 0 auto", padding: "5px 10px", borderRadius: 999, fontSize: 10.5, fontWeight: 850, whiteSpace: "nowrap" },
  actionGroup: { display: "flex", alignItems: "center", gap: 8 },
  paidBtn: { minHeight: 40, background: "#047857", border: "none", borderRadius: 10, color: "#fff", fontWeight: 800, fontSize: 13, cursor: "pointer", padding: "0 14px" },
  paymentSummary: { width: "100%", color: "#047857", fontSize: 11.5, fontWeight: 700 },
  shareBtn: { background: "#16324F", border: "none", borderRadius: 7, color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer", padding: "7px 10px" },
  printBtn: { background: "#fff", border: "1px solid #16324F", borderRadius: 7, color: "#16324F", fontWeight: 700, fontSize: 12, cursor: "pointer", padding: "7px 10px" },
  editBtn: { background: "none", border: "none", color: "#2E7D8C", fontWeight: 700, fontSize: 12.5, cursor: "pointer", padding: 0 },
  deleteBtn: { background: "none", border: "none", color: "#B3451D", fontWeight: 700, fontSize: 12, cursor: "pointer", padding: 0 },
  locked: { width: 46, color: "#746A59", fontWeight: 700, fontSize: 11.5 },
};
