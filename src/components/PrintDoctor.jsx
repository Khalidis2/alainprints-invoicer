import { useEffect, useRef } from "react";
import { supabase } from "../lib/supabaseClient";

// Print Doctor lives in public/print-doctor.html. This tab shows it and hands it the signed-in admin's token.
export default function PrintDoctor() {
  const frame = useRef(null);

  useEffect(() => {
    const onMessage = async (event) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      if (!event.data || typeof event.data.pdToken === "undefined") return;
      const { data } = await supabase.auth.getSession();
      event.source.postMessage({ pdTokenReply: event.data.pdToken, token: data?.session?.access_token || "" }, window.location.origin);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <iframe
      ref={frame}
      title="Print Doctor"
      src="/print-doctor.html"
      allow="camera"
      style={{ width: "100%", height: "calc(100dvh - 40px)", minHeight: 640, border: "1px solid #E4DFD3", borderRadius: 12, background: "#fff" }}
    />
  );
}
