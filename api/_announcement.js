import { env, supabaseFetch } from "./_stripe-shared.js";

// One-time fix of the website banner: it said "free delivery above AED 500", but delivery is now AED 25
// under 10 spools and free from 10. Only a banner that still mentions 500 is changed; a banner the owner
// already rewrote is left alone. Runs once (marker in settings), on the first store visit after deploy.
const MARKER = "announcement_delivery_fix_v1";
const NEW_TEXT = "Free delivery on 10 spools or more. AED 25 delivery under 10 spools.";
let done = false;

export async function fixAnnouncementOnce() {
  if (done || !env("SUPABASE_SERVICE_ROLE_KEY")) return;
  try {
    const marker = await supabaseFetch(`/rest/v1/settings?key=eq.${MARKER}&select=key&limit=1`);
    if (!marker?.length) {
      const rows = await supabaseFetch("/rest/v1/settings?key=eq.announcement_banner&select=value&limit=1");
      const text = typeof rows?.[0]?.value === "string" ? rows[0].value : "";
      if (/\b500\b/.test(text)) {
        await supabaseFetch("/rest/v1/settings?key=eq.announcement_banner", { method: "PATCH", body: { value: NEW_TEXT } });
      }
      await supabaseFetch("/rest/v1/settings", { method: "POST", body: { key: MARKER, value: true } }).catch(() => null);
    }
    done = true;
  } catch {
    // try again on a later visit
  }
}
