import { useCallback, useEffect, useState } from "react";

// Shows the exact stock list printtools3d.com receives (same /api/store-stock endpoint the Store calls).
export default function LiveWebsiteStock({ refreshKey }) {
  const [rows, setRows] = useState([]);
  const [state, setState] = useState("loading");
  const [checkedAt, setCheckedAt] = useState(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch(`/api/store-stock?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      setRows(Array.isArray(data.inventory) ? data.inventory : []);
      setCheckedAt(new Date());
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const total = rows.reduce((sum, row) => sum + Number(row.stock || 0), 0);

  return (
    <div className="live-stock">
      <div className="live-stock-head">
        <div>
          <strong>Live on the website</strong>
          <small>
            {state === "ready" && `${total} spools in ${rows.length} colours · checked ${checkedAt.toLocaleTimeString()}`}
            {state === "loading" && "Checking what printtools3d.com shows…"}
            {state === "error" && "Couldn't reach the website stock feed. The Store will show \"stock unavailable\" until this works."}
          </small>
        </div>
        <button type="button" onClick={load} disabled={state === "loading"}>Refresh</button>
      </div>
      {state === "ready" && rows.length > 0 && (
        <div className="live-stock-table">
          <table>
            <thead><tr><th>Material</th><th>Colour</th><th>Spools</th><th>Price</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.material}-${row.color}`}>
                  <td>{row.material}</td>
                  <td>{row.color}</td>
                  <td>{row.stock}</td>
                  <td>AED {Number(row.price || 0).toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {state === "ready" && rows.length === 0 && <p>No spools are showing on the website. Check the Stock tab: spools must be Available, have a selling price, and at least one full spool left.</p>}
      <p className="live-stock-note">Updates within about 10 seconds of saving an Unpaid or Paid invoice.</p>
    </div>
  );
}
