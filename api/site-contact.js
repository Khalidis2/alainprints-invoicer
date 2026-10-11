import { env } from "./_stripe-shared.js";
import { cors, SITE_URL } from "./_store-shared.js";

// Contact form on the website: emails the shop owner via Resend. Nothing is stored.
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const clean = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const TOPICS = new Set(["Filament", "Custom print", "Other"]);

export default async function handler(request, response) {
  cors(request, response, "POST, OPTIONS");
  if (request.method === "OPTIONS") return response.status(204).end();
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });

  const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
  const name = clean(body.name, 80);
  const contact = clean(body.contact, 120);
  const message = clean(body.message, 2000);
  const topic = TOPICS.has(body.topic) ? body.topic : "Other";
  const isEmail = /^\S+@\S+\.\S+$/.test(contact);
  const isPhone = /^\+?[\d\s-]{8,}$/.test(contact);
  if (!name) return response.status(400).json({ error: "Please add your name." });
  if (!isEmail && !isPhone) return response.status(400).json({ error: "Enter a phone number or an email." });
  if (message.length < 5) return response.status(400).json({ error: "Tell us a little more." });

  const key = env("RESEND_API_KEY");
  if (!key) return response.status(503).json({ error: "Messages are unavailable right now." });
  const to = env("ORDER_EMAIL_TO") || "itsalainprints@gmail.com";
  const from = env("ORDER_EMAIL_FROM") || "printtools3d orders <onboarding@resend.dev>";

  const html = `
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2937">
    <div style="margin:0 0 18px"><img src="${SITE_URL}/logo-round.png" width="56" height="56" alt="Alain Prints" style="border-radius:50%;vertical-align:middle"><span style="margin-left:12px;font-size:18px;font-weight:bold;letter-spacing:3px;color:#0f6b64;vertical-align:middle">ALAIN PRINTS</span></div>
    <h2 style="margin:0 0 4px">New website message: ${escapeHtml(topic)}</h2>
    <p style="margin:0 0 12px;color:#6b7280">From the contact form on printtools3d.com</p>
    <p><b>Name:</b> ${escapeHtml(name)}<br><b>${isEmail ? "Email" : "Phone"}:</b> ${escapeHtml(contact)}</p>
    <p style="white-space:pre-wrap;background:#f9fafb;padding:12px;border-radius:8px">${escapeHtml(message)}</p>
  </div>`;

  try {
    const result = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], ...(isEmail ? { reply_to: contact } : {}), subject: `Website message (${topic}) from ${name}`, html }),
    });
    if (!result.ok) return response.status(502).json({ error: "Could not send the message." });
    return response.status(200).json({ ok: true });
  } catch {
    return response.status(502).json({ error: "Could not send the message." });
  }
}
