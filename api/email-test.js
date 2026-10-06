import { env, supabaseFetch } from "./_stripe-shared.js";

// Admin-only: sends a test email through Resend and returns Resend's exact answer.
export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
  const token = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
  try {
    await supabaseFetch("/auth/v1/user", { token });
  } catch {
    return response.status(401).json({ error: "Please sign in again." });
  }

  const key = env("RESEND_API_KEY");
  const to = env("ORDER_EMAIL_TO") || "itsalainprints@gmail.com";
  const from = env("ORDER_EMAIL_FROM") || "printtools3d orders <onboarding@resend.dev>";
  const replyTo = env("ORDER_EMAIL_REPLY_TO") || to;
  if (!key) return response.status(200).json({ ok: false, problem: "RESEND_API_KEY is not set on this deployment. Add it in Vercel (alainprints-invoicer), then Redeploy." });

  try {
    const result = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key.trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], reply_to: replyTo, subject: "Test: printtools3d order emails work", html: "<p>If you can read this, order emails are connected. 🎉</p>" }),
    });
    const data = await result.json().catch(() => ({}));
    if (result.ok) return response.status(200).json({ ok: true, to, from, id: data.id });
    return response.status(200).json({ ok: false, to, from, status: result.status, problem: explain(result.status, data?.message || data?.name || "") });
  } catch (error) {
    return response.status(200).json({ ok: false, problem: `Couldn't reach Resend: ${error.message}` });
  }
}

function explain(status, message) {
  if (/only send testing emails to your own email/i.test(message)) {
    return `Resend: ${message} → Your Resend account must be signed up with itsalainprints@gmail.com, or verify your domain in Resend and set ORDER_EMAIL_FROM.`;
  }
  if (status === 401 || status === 403) return `Resend rejected the API key (${status}: ${message}). Create a new key with Sending access and paste it again in Vercel, then Redeploy.`;
  return `Resend error ${status}: ${message}`;
}
