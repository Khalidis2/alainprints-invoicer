import { useState } from "react";
import { AED, today } from "../lib/helpers";
import { StripeLinkButton, StripeLinkDetails, initialStripeUrl } from "./StripeLinkPanel";
import {
  hasWhatsAppNumber,
  isPartPaid,
  paymentsOf,
  receivedSoFar,
  reminderText,
  remainingOf,
  round2,
  waNumber,
  displayStatus,
} from "../lib/invoiceMath";

const PILL = {
  Draft: ["#6B7280", "#F3F4F6"],
  Unpaid: ["#B45309", "#FFF7ED"],
  "Part paid": ["#B45309", "#FFF7ED"],
  Paid: ["#047857", "#ECFDF5"],
  Refunded: ["#6D28D9", "#F5F3FF"],
  Cancelled: ["#B91C1C", "#FEF2F2"],
};

const dueNote = (invoice) => {
  if (!invoice.dueDate || (invoice.status || "Unpaid") !== "Unpaid") return null;
  const days = Math.round((new Date(`${invoice.dueDate}T00:00:00`).getTime() - new Date(`${today()}T00:00:00`).getTime()) / 86400000);
  if (Number.isNaN(days)) return null;
  if (days < 0) return { text: `Overdue by ${-days} day${days === -1 ? "" : "s"}`, color: "#B91C1C" };
  if (days === 0) return { text: "Due today", color: "#B45309" };
  return { text: `Due in ${days} day${days === 1 ? "" : "s"}`, color: "#6B6355" };
};

function timeline(invoice) {
  const events = [];
  const status = invoice.status || "Unpaid";
  const payments = paymentsOf(invoice);
  payments.forEach((payment) => events.push({
    key: payment.id || `${payment.date}-${payment.amount}`,
    date: payment.date || invoice.date,
    color: "#047857",
    title: `${AED(payment.amount)} received`,
    sub: [payment.method, payment.date].filter(Boolean).join(" · "),
  }));
  if (status === "Paid") {
    const rest = round2(Number(invoice.total || 0) - payments.reduce((sum, p) => sum + Number(p.amount), 0));
    events.push({
      key: "paid",
      date: invoice.paidDate || invoice.date,
      color: "#047857",
      title: rest > 0 && payments.length ? `Paid in full (${AED(rest)} final payment)` : "Paid in full",
      sub: [invoice.paymentMethod, invoice.paidDate, invoice.paymentReference ? `Ref ${invoice.paymentReference}` : ""].filter(Boolean).join(" · "),
    });
  }
  if (invoice.stripeLinkUrl) events.push({ key: "link", date: invoice.date, color: "#2E7D8C", title: "Card payment link created", sub: "Pays by Stripe" });
  if (status === "Refunded") events.push({ key: "refund", date: invoice.refundedDate || invoice.date, color: "#6D28D9", title: "Refunded", sub: "Spools returned to stock" });
  if (status === "Cancelled") events.push({ key: "cancel", date: invoice.date, color: "#B91C1C", title: "Cancelled", sub: "Spools returned to stock" });
  events.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  events.push({ key: "created", date: invoice.date, color: "#16324F", title: "Invoice created", sub: (invoice.lines || []).some((line) => line.filamentId) && ["Unpaid", "Paid"].includes(status) ? `Stock reserved · ${invoice.date}` : invoice.date });
  return events;
}

export default function InvoiceDetail({ invoice, onBack, onUpdate, onEdit, onDuplicate, onPrint, onShare, onStatus, onDelete, onRefresh, showToast }) {
  const status = invoice.status || "Unpaid";
  const shown = displayStatus(invoice);
  const [pillColor, pillBg] = PILL[shown] || PILL.Unpaid;
  const received = receivedSoFar(invoice);
  const left = remainingOf(invoice);
  const total = Number(invoice.total || 0);
  const percent = total > 0 ? Math.min(100, (received / total) * 100) : 0;
  const due = dueNote(invoice);
  const open = status === "Unpaid";
  const editable = ["Draft", "Unpaid"].includes(status);
  const canWhatsApp = hasWhatsAppNumber(invoice.customer?.phone);
  const message = reminderText({ ...invoice, stripeLinkUrl: invoice.stripeLinkUrl }, AED);

  const [stripeUrl, setStripeUrl] = useState(initialStripeUrl(invoice));
  const [paying, setPaying] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Cash");
  const [busy, setBusy] = useState(false);

  const typed = round2(Math.max(0, Number(amount) || 0));
  const completes = typed > 0 && typed >= left - 0.005;
  const tooMuch = typed > left + 0.005;

  const savePayment = async () => {
    if (typed <= 0 || tooMuch) return;
    setBusy(true);
    try {
      const payment = { id: `pay-${Date.now()}`, date: today(), amount: typed, method };
      await onUpdate({
        ...invoice,
        payments: [...paymentsOf(invoice), payment],
        status: completes ? "Paid" : "Unpaid",
        paidDate: completes ? today() : invoice.paidDate,
        paymentMethod: completes ? method : invoice.paymentMethod,
      });
      showToast(completes ? `INV-${invoice.number} paid in full` : `${AED(typed)} payment saved`);
      setPaying(false);
      setAmount("");
    } catch {
      showToast("Couldn't save the payment, check connection");
    } finally {
      setBusy(false);
    }
  };

  const copyReminder = async () => {
    try {
      await navigator.clipboard.writeText(message);
      showToast("Reminder copied, paste it into any app");
    } catch {
      showToast("Couldn't copy the reminder");
    }
  };

  const events = timeline(invoice);

  return (
    <div className="inv-detail" style={s.wrap}>
      <div style={s.band}>
        <div style={s.bandTop}>
          <button type="button" style={s.back} onClick={onBack} aria-label="Back to invoices">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={s.kicker}>INVOICE</div>
            <div style={s.number}>INV-{invoice.number}</div>
          </div>
          <span style={{ ...s.pill, color: pillColor, background: pillBg }}>{shown.toUpperCase()}</span>
        </div>
        <div style={s.bandSub}>
          <b>{invoice.customer?.name || "Walk-in customer"}</b>
          <span>{[invoice.customer?.phone, invoice.date, invoice.dueDate ? `due ${invoice.dueDate}` : ""].filter(Boolean).join(" · ")}</span>
        </div>
      </div>

      <div style={s.card}>
        {open ? (
          <>
            <div style={s.cardTop}>
              <small style={s.small}>STILL TO PAY</small>
              {due && <b style={{ fontSize: 12.5, color: due.color }}>{due.text}</b>}
            </div>
            <div style={s.big}>{AED(left)}</div>
            {received > 0 && (
              <>
                <div style={s.track}><div style={{ ...s.fill, width: `${percent}%` }} /></div>
                <div style={s.trackLabels}><span>{AED(received)} received</span><span>of {AED(total)}</span></div>
              </>
            )}
          </>
        ) : (
          <>
            <small style={s.small}>{status === "Paid" ? "PAID IN FULL" : status.toUpperCase()}</small>
            <div style={{ ...s.big, color: status === "Paid" ? "#047857" : "#16324F" }}>{AED(total)}</div>
            {status === "Paid" && <div style={s.trackLabels}><span>{[invoice.paidDate, invoice.paymentMethod].filter(Boolean).join(" · ") || "Date not recorded"}</span></div>}
          </>
        )}
      </div>

      {open && (
        canWhatsApp ? (
          <a style={s.primary} href={`https://wa.me/${waNumber(invoice.customer.phone)}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1B2A3D" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 4L3 11l7 3 3 7z" /><path d="M10 14l11-10" /></svg>
            Send reminder on WhatsApp
          </a>
        ) : (
          <button type="button" style={{ ...s.primary, border: 0, cursor: "pointer" }} onClick={copyReminder}>Copy reminder text</button>
        )
      )}

      <div style={s.actions}>
        {open && <button type="button" style={{ ...s.act, ...s.actGood }} onClick={() => { setPaying((value) => !value); setAmount(String(left)); }}>Add payment</button>}
        <button type="button" style={s.act} onClick={onShare}>Share PDF</button>
        <button type="button" style={s.act} onClick={onPrint}>Print</button>
        <button type="button" style={s.act} onClick={onDuplicate}>Duplicate</button>
      </div>

      {paying && open && (
        <div style={s.payBox}>
          <label style={s.label}>Amount received (AED)</label>
          <input style={s.input} type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} aria-label="Amount received" />
          <label style={s.label}>Paid by</label>
          <div style={s.seg}>
            {["Cash", "Card", "Bank Transfer"].map((entry) => (
              <button key={entry} type="button" style={{ ...s.segBtn, ...(method === entry ? s.segOn : {}) }} onClick={() => setMethod(entry)}>{entry === "Bank Transfer" ? "Transfer" : entry}</button>
            ))}
          </div>
          <div style={s.hint}>
            {tooMuch ? `That is more than the ${AED(left)} still owed.` : completes ? "This pays the invoice in full and marks it Paid. Stock is taken out." : typed > 0 ? `${AED(round2(left - typed))} will still be owed. Stock stays reserved.` : "Enter the amount the customer paid."}
          </div>
          <button type="button" style={{ ...s.save, opacity: typed <= 0 || tooMuch || busy ? 0.5 : 1 }} disabled={typed <= 0 || tooMuch || busy} onClick={savePayment}>
            {busy ? "Saving…" : completes ? "Save and mark paid" : "Save payment"}
          </button>
        </div>
      )}

      {open && (
        <>
          <div style={s.heading}>Reminder preview</div>
          <div style={s.bubble}>{message}</div>
          <div style={s.hint}>{canWhatsApp ? "Opens WhatsApp with this text filled in. You press send." : "Add a phone number to this customer to send it on WhatsApp."}</div>
        </>
      )}

      {open && (
        <>
          <div style={s.heading}>Card payment</div>
          {!stripeUrl && <StripeLinkButton invoice={invoice} showToast={showToast} onUrl={setStripeUrl} />}
          <StripeLinkDetails invoice={invoice} url={stripeUrl} showToast={showToast} onPaid={onRefresh} />
        </>
      )}

      <div style={s.heading}>Items</div>
      <div style={s.list}>
        {(invoice.lines || []).map((line, index) => (
          <div key={`${line.itemId}-${index}`} style={s.line}>
            <div style={{ minWidth: 0 }}>
              <div style={s.lineName}>{line.name}</div>
              <div style={s.lineSub}>{line.qty} × {AED(line.price)}</div>
            </div>
            <b>{AED(Number(line.price || 0) * Number(line.qty || 0))}</b>
          </div>
        ))}
        {Number(invoice.discount) > 0 && <div style={s.line}><span style={s.lineSub}>Discount</span><b>− {AED(invoice.discount)}</b></div>}
      </div>

      <div style={s.heading}>Activity</div>
      <div style={s.list}>
        {events.map((event, index) => (
          <div key={event.key} style={s.event}>
            <div style={s.rail}><i style={{ ...s.dot, background: event.color }} />{index < events.length - 1 && <u style={s.stem} />}</div>
            <div>
              <div style={s.eventTitle}>{event.title}</div>
              <div style={s.lineSub}>{event.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {!["Cancelled", "Refunded"].includes(status) && (
        <label style={s.statusRow}>
          <span>Change status</span>
          <select style={s.statusSelect} value={status} onChange={(event) => onStatus(event.target.value)} aria-label="Change status">
            {["Draft", "Unpaid", "Paid", "Cancelled", "Refunded"].map((option) => <option key={option}>{option}</option>)}
          </select>
        </label>
      )}

      <div style={s.foot}>
        {editable && <button type="button" style={s.footBtn} onClick={onEdit}>Edit</button>}
        {status === "Draft" && <button type="button" style={{ ...s.footBtn, ...s.footDanger }} onClick={onDelete}>Delete draft</button>}
        {status === "Unpaid" && <button type="button" style={{ ...s.footBtn, ...s.footDanger }} onClick={() => onStatus("Cancelled")}>Cancel invoice</button>}
        {status === "Paid" && <button type="button" style={{ ...s.footBtn, color: "#6D28D9", borderColor: "#DDD6FE" }} onClick={() => onStatus("Refunded")}>Mark refunded</button>}
      </div>
    </div>
  );
}

const s = {
  wrap: { display: "grid", gap: 12, maxWidth: 640, margin: "0 auto" },
  band: { padding: "14px 16px 16px", borderRadius: 16, background: "#16324F", color: "#fff" },
  bandTop: { display: "flex", alignItems: "center", gap: 12 },
  back: { width: 44, height: 44, flex: "0 0 auto", border: 0, borderRadius: 12, background: "#27496B", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" },
  kicker: { color: "#CFDBE8", fontSize: 11, fontWeight: 800, letterSpacing: ".1em" },
  number: { fontSize: 22, fontWeight: 900 },
  pill: { padding: "5px 11px", borderRadius: 999, fontSize: 11, fontWeight: 850, whiteSpace: "nowrap" },
  bandSub: { display: "grid", gap: 2, marginTop: 14, fontSize: 14 },
  card: { padding: 16, border: "1px solid #E4DFD3", borderRadius: 14, background: "#fff" },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 },
  small: { color: "#6B6355", fontSize: 11, fontWeight: 800, letterSpacing: ".08em" },
  big: { marginTop: 2, color: "#16324F", fontSize: 36, fontWeight: 900, letterSpacing: "-.01em" },
  track: { height: 10, marginTop: 12, overflow: "hidden", borderRadius: 5, background: "#EFEAE0" },
  fill: { height: "100%", background: "#047857" },
  trackLabels: { display: "flex", justifyContent: "space-between", gap: 8, marginTop: 6, color: "#6B6355", fontSize: 12.5, fontWeight: 700 },
  primary: { display: "flex", alignItems: "center", justifyContent: "center", gap: 10, minHeight: 56, borderRadius: 14, background: "#E8792D", color: "#1B2A3D", fontSize: 16, fontWeight: 900, textDecoration: "none" },
  actions: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(128px, 1fr))", gap: 8 },
  act: { minHeight: 50, whiteSpace: "nowrap", border: "1.5px solid #16324F", borderRadius: 12, background: "#fff", color: "#16324F", fontSize: 13, fontWeight: 800, cursor: "pointer" },
  actGood: { borderColor: "#047857", background: "#ECFDF5", color: "#047857" },
  payBox: { padding: 14, border: "1.5px solid #CFE9DD", borderRadius: 14, background: "#F4FAF7" },
  label: { display: "block", margin: "10px 0 6px", color: "#6B6355", fontSize: 11.5, fontWeight: 800 },
  input: { width: "100%", boxSizing: "border-box", minHeight: 48, padding: "0 12px", border: "1.5px solid #DCD5C6", borderRadius: 10, background: "#fff", color: "#1B2A3D", fontSize: 16, fontWeight: 700 },
  seg: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 },
  segBtn: { minHeight: 46, border: "1.5px solid #DCD5C6", borderRadius: 10, background: "#fff", color: "#16324F", fontWeight: 750, fontSize: 13, cursor: "pointer" },
  segOn: { background: "#16324F", borderColor: "#16324F", color: "#fff" },
  hint: { marginTop: 8, color: "#6B6355", fontSize: 12.5, lineHeight: 1.5 },
  save: { width: "100%", minHeight: 52, marginTop: 12, border: 0, borderRadius: 12, background: "#047857", color: "#fff", fontSize: 15, fontWeight: 850, cursor: "pointer" },
  heading: { margin: "10px 2px 0", color: "#16324F", fontSize: 16, fontWeight: 850 },
  bubble: { padding: "12px 14px", border: "1px solid #CFE9DD", borderRadius: "14px 14px 14px 4px", background: "#ECFDF5", color: "#1B2A3D", fontSize: 14, lineHeight: 1.5 },
  list: { border: "1px solid #E4DFD3", borderRadius: 13, background: "#fff", overflow: "hidden" },
  line: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: "1px solid #EFEAE0", color: "#16324F" },
  lineName: { fontSize: 14, fontWeight: 800 },
  lineSub: { color: "#6B6355", fontSize: 12.5 },
  event: { display: "flex", gap: 12, padding: "0 14px" },
  rail: { display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 15 },
  dot: { width: 12, height: 12, borderRadius: "50%", display: "block" },
  stem: { width: 2, flex: 1, background: "#E4DFD3", marginTop: 4, textDecoration: "none" },
  eventTitle: { paddingTop: 10, color: "#1B2A3D", fontSize: 14, fontWeight: 800 },
  statusRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 14px", border: "1px solid #E4DFD3", borderRadius: 13, background: "#fff", color: "#16324F", fontSize: 14, fontWeight: 800 },
  statusSelect: { minHeight: 44, minWidth: 130, padding: "0 10px", border: "1.5px solid #DCD5C6", borderRadius: 10, background: "#fff", color: "#1B2A3D", fontSize: 14, fontWeight: 700 },
  foot: { display: "flex", flexWrap: "wrap", gap: 10, marginTop: 6 },
  footBtn: { flex: "1 1 140px", minHeight: 50, border: "1.5px solid #DCD5C6", borderRadius: 12, background: "#fff", color: "#16324F", fontSize: 14, fontWeight: 800, cursor: "pointer" },
  footDanger: { borderColor: "#FECACA", background: "#FEF2F2", color: "#B91C1C" },
};
