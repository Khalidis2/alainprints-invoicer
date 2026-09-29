import { useEffect, useState } from "react";
import { fetchWebsiteSettings, saveWebsiteSettings } from "../lib/storage";

export default function WebsiteSettings({ filaments, items }) {
  const [settings, setSettings] = useState({ storeOpen: true, announcement: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetchWebsiteSettings()
      .then(setSettings)
      .finally(() => setLoading(false));
  }, []);

  const availableSpools = filaments
    .filter((item) => item.stockStatus === "available")
    .reduce((sum, item) => sum + Math.floor(Number(item.remainingG || 0) / Number(item.spoolWeightG || 1000)), 0);

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      await saveWebsiteSettings(settings);
      setMessage("Website settings saved.");
    } catch {
      setMessage("Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <div className="admin-section-heading">
        <div>
          <span className="admin-eyebrow">PRINTTOOLS3D</span>
          <h2>Website controls</h2>
          <p>Changes here control the public Store and announcement banner.</p>
        </div>
        <a className="admin-site-link" href="https://www.printtools3d.com/store" target="_blank" rel="noreferrer">Preview Store ↗</a>
      </div>

      <div className="website-control-panel">
        <label className="website-toggle">
          <span><strong>Accept Store orders</strong><small>Turn this off to pause new Store orders.</small></span>
          <input type="checkbox" checked={settings.storeOpen} disabled={loading} onChange={(event) => setSettings({ ...settings, storeOpen: event.target.checked })} />
        </label>
        <label className="website-announcement">
          <span>Announcement banner</span>
          <textarea rows="3" maxLength="180" value={settings.announcement} disabled={loading} onChange={(event) => setSettings({ ...settings, announcement: event.target.value })} placeholder="Example: Free UAE delivery on orders over AED 150." />
          <small>{settings.announcement.length}/180 · Leave empty to hide the banner.</small>
        </label>
        <div className="website-save-row">
          <span role="status">{message}</span>
          <button type="button" onClick={save} disabled={loading || saving}>{saving ? "Saving…" : "Save website settings"}</button>
        </div>
      </div>

      <div className="website-settings-grid">
        <article><span>Store inventory</span><strong>{availableSpools} sellable spools</strong><p>Available full spools appear automatically.</p></article>
        <article><span>Printed products</span><strong>{items.length} saved products</strong><p>Edit products from the Printed products tab.</p></article>
        <article><span>Store status</span><strong>{settings.storeOpen ? "Open" : "Closed"}</strong><p>{settings.storeOpen ? "Customers can build and submit orders." : "Ordering is paused until you reopen it."}</p></article>
      </div>
    </section>
  );
}
