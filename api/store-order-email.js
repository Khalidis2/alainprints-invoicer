import { getInvoiceRow, readMeta, supabaseFetch } from "./_stripe-shared.js";
import { emailOrder, emailInvoiceToCustomer, getStoreOrder } from "./_store-shared.js";
import { invoicePdfFromRow } from "./_invoice-pdf.js";
import { LabelError, readLabel } from "./_label-ai.js";

// Admin-only: sends the order email for one store order again and returns Resend's exact answer.
export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
  const token = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
  try {
    await supabaseFetch("/auth/v1/user", { token });
  } catch {
    return response.status(401).json({ error: "Please sign in again." });
  }

  try {
    const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
    if (body.labelPhoto) {
      try {
        return response.status(200).json(await readLabel(body.labelPhoto));
      } catch (error) {
        return response.status(error instanceof LabelError ? error.status : 502).json({ error: error.message || "The AI could not read that photo." });
      }
    }
    if (body.invoiceId) {
      const row = await getInvoiceRow(String(body.invoiceId));
      if (!row) return response.status(404).json({ error: "Invoice not found" });
      const meta = readMeta(row);
      const email = String(body.email || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response.status(400).json({ error: "Enter a valid email" });
      const pdf = await invoicePdfFromRow(row, meta).catch((error) => { console.error("Invoice PDF failed", row.number, error.message); return null; });
      const result = await emailInvoiceToCustomer(row, meta, email, pdf);
      return response.status(200).json({ ok: Boolean(result.sent), result, error: result.sent ? undefined : result.skipped || (result.failed ? `Email not sent (${result.failed})` : "Email not sent") });
    }
    const id = String(body.id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return response.status(400).json({ error: "Missing order" });
    const order = await getStoreOrder(`id=eq.${id}`);
    if (!order) return response.status(404).json({ error: "Order not found" });
    const headline = order.payment_status === "paid" ? "PAID website order (resent)" : "Website order (resent)";
    const result = await emailOrder(order, headline);
    return response.status(200).json({ ok: Boolean(result.sent), reference: order.reference, result });
  } catch (error) {
    return response.status(200).json({ ok: false, result: { failed: error.message } });
  }
}
