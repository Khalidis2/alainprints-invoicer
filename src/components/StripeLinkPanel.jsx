import { useState } from "react";
import { createPaymentLink } from "../lib/storage";
import { AED } from "../lib/helpers";

// Stripe payment link for an Unpaid invoice: create once, then WhatsApp / copy.
export function initialStripeUrl(invoice) {
  return invoice.stripeLinkUrl && Number(invoice.stripeLinkAmount) === Math.round(Number(invoice.total) * 100) ? invoice.stripeLinkUrl : "";
}

export function StripeLinkButton({ invoice, onUrl, showToast, compact = false, label = "Stripe link" }) {
  const [busy, setBusy] = useState(false);
  if ((invoice.status || "Unpaid") !== "Unpaid") return null;
  const getLink = async () => {
    setBusy(true);
    try {
      onUrl(await createPaymentLink(invoice.id));
    } catch (error) {
      showToast?.(error.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" style={compact ? s.stripeBtnCompact : s.stripeBtn} disabled={busy} onClick={getLink}>
      {busy ? "Creating…" : label}
    </button>
  );
}

export function StripeLinkDetails({ invoice, url, showToast }) {
  if (!url || (invoice.status || "Unpaid") !== "Unpaid") return null;
  const message = `Hi ${invoice.customer?.name || ""}, here is your payment link for alainprints invoice #${invoice.number} (${AED(invoice.total)}):\n${url}\nThank you!`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      showToast?.("Payment link copied");
    } catch {
      window.prompt("Copy this link:", url);
    }
  };
  const whatsapp = () => {
    const phone = uaeWhatsAppNumber(invoice.customer?.phone);
    const text = encodeURIComponent(message);
    window.open(phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`, "_blank", "noopener");
  };
  return (
    <div className="stripe-link-details" style={s.panel}>
      <div style={s.head}><span style={s.dot} /> Card payment link · {AED(invoice.total)}</div>
      <a href={url} target="_blank" rel="noopener noreferrer" style={s.url}>{url.replace(/^https:\/\//, "")}</a>
      <div style={s.row}>
        <button type="button" style={s.waBtn} onClick={whatsapp}>WhatsApp</button>
        <button type="button" style={s.ghostBtn} onClick={copy}>Copy link</button>
      </div>
      <div style={s.note}>Marks itself Paid when the customer pays. One payment only.</div>
    </div>
  );
}

// Button + details together (used on the screen right after creating an invoice).
export default function StripeLinkPanel({ invoice, showToast, onLink }) {
  const [url, setUrl] = useState(initialStripeUrl(invoice));
  if ((invoice.status || "Unpaid") !== "Unpaid") return null;
  if (!url) {
    return (
      <div style={s.intro}>
        <span>Customer paying by card?</span>
        <StripeLinkButton invoice={invoice} showToast={showToast} label="Create Stripe payment link" onUrl={(link) => { setUrl(link); onLink?.(link); }} />
      </div>
    );
  }
  return <StripeLinkDetails invoice={invoice} url={url} showToast={showToast} />;
}

function uaeWhatsAppNumber(phone) {
  const digits = String(phone || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("971")) return digits;
  if (digits.startsWith("00971")) return digits.slice(2);
  if (/^05\d{8}$/.test(digits)) return `971${digits.slice(1)}`;
  if (/^5\d{8}$/.test(digits)) return `971${digits}`;
  return digits.length >= 10 ? digits : "";
}

const s = {
  stripeBtn: { minHeight: 40, padding: "0 14px", borderRadius: 8, border: "1.5px solid #635BFF", background: "#635BFF", color: "#fff", fontWeight: 800, fontSize: 13, cursor: "pointer" },
  stripeBtnCompact: { minHeight: 36, padding: "0 12px", borderRadius: 8, border: "1.5px solid #635BFF", background: "#635BFF", color: "#fff", fontWeight: 800, fontSize: 12.5, cursor: "pointer" },
  intro: { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10, padding: 12, borderRadius: 10, background: "#F5F4FF", border: "1px solid #D9D6FF", color: "#3B3599", fontSize: 13, fontWeight: 700 },
  panel: { width: "100%", flexBasis: "100%", gridColumn: "1 / -1", display: "grid", gap: 8, marginTop: 4, padding: 12, borderRadius: 10, background: "#F5F4FF", border: "1px solid #D9D6FF" },
  head: { display: "flex", alignItems: "center", gap: 8, color: "#3B3599", fontSize: 12.5, fontWeight: 800 },
  dot: { width: 8, height: 8, borderRadius: "50%", background: "#635BFF" },
  url: { color: "#1B2A3D", fontSize: 12.5, fontWeight: 700, wordBreak: "break-all" },
  row: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  waBtn: { minHeight: 40, borderRadius: 8, border: "none", background: "#128C4A", color: "#fff", fontWeight: 800, cursor: "pointer" },
  ghostBtn: { minHeight: 40, borderRadius: 8, border: "1.5px solid #635BFF", background: "#fff", color: "#3B3599", fontWeight: 800, cursor: "pointer" },
  note: { color: "#5B5880", fontSize: 11.5 },
};
