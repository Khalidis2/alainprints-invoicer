import { useState } from "react";
import { sendTestEmail } from "../lib/storage";

// Website tab: one tap to check that order emails (Resend) work, with the exact reason if not.
export default function EmailTest() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      setState(await sendTestEmail());
    } catch (error) {
      setState({ ok: false, problem: error.message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={s.box}>
      <div style={s.head}>
        <div>
          <strong style={s.title}>Order emails</strong>
          <small style={s.sub}>New website orders are emailed to you through Resend.</small>
        </div>
        <button type="button" style={s.btn} disabled={busy} onClick={run}>{busy ? "Sending…" : "Send test email"}</button>
      </div>
      {state && (
        <p style={{ ...s.result, ...(state.ok ? s.ok : s.bad) }}>
          {state.ok ? `Sent to ${state.to}. Check your inbox (and spam the first time).` : state.problem}
        </p>
      )}
    </div>
  );
}

const s = {
  box: { display: "grid", gap: 10, marginBottom: 18, padding: 18, border: "1px solid #E4DFD3", borderRadius: 13, background: "#fff" },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
  title: { display: "block", color: "#16324F", fontSize: 16 },
  sub: { display: "block", marginTop: 3, color: "#6B6355", fontSize: 12.5 },
  btn: { minHeight: 42, padding: "0 16px", border: "1px solid #16324F", borderRadius: 8, background: "#16324F", color: "#fff", fontWeight: 800, cursor: "pointer" },
  result: { margin: 0, padding: "10px 12px", borderRadius: 8, fontSize: 13, lineHeight: 1.5, wordBreak: "break-word" },
  ok: { background: "#ECFDF5", color: "#047857" },
  bad: { background: "#FEF2F2", color: "#B91C1C" },
};
