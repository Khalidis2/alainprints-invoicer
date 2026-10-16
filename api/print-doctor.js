import ask from "./_pd-ask.js";
import data from "./_pd-data.js";

// Print Doctor (admin only). One function for both parts to stay inside Vercel's 12-function limit.
// POST ?r=ask  -> send a problem + photos to the AI
// GET/POST ?r=data (default) -> history, lessons, printers
export default async function handler(req, res) {
  return req.query?.r === "ask" ? ask(req, res) : data(req, res);
}
