import { supabaseFetch } from './_stripe-shared.js';

// Shared helpers (files starting with _ are not public endpoints on Vercel)

export const newId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const stripTitle = t => t.replace(/^\s*\**TITLE:.*(\n|$)/i, '').trimStart();

// Only the signed-in admin of this app can use Print Doctor (same sign-in as the rest of the admin).
export async function checkAuth(req, res) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  try {
    await supabaseFetch('/auth/v1/user', { token });
    return true;
  } catch {
    res.status(401).json({ error: 'Please sign in again.' });
    return false;
  }
}

/* ---------- Database: Upstash Redis (free, REST) ----------
   Vercel -> Storage -> Upstash Redis sets KV_REST_API_URL / KV_REST_API_TOKEN for you. */
async function redis(...cmd) {
  const url = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Database not set up: add a free Upstash Redis database in Vercel -> Storage.');
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(`Database error ${r.status}: ${String(d.error || '').slice(0, 200)}`);
  return d.result;
}
const parse = v => { try { return JSON.parse(v); } catch { return null; } };

export const db = {
  async get(hash, id) { const v = await redis('HGET', hash, String(id)); return v ? parse(v) : null; },
  async set(hash, id, obj) { await redis('HSET', hash, String(id), JSON.stringify(obj)); },
  async del(hash, id) { await redis('HDEL', hash, String(id)); },
  async all(hash) {
    const flat = (await redis('HGETALL', hash)) || [];
    const out = [];
    for (let i = 1; i < flat.length; i += 2) { const o = parse(flat[i]); if (o) out.push(o); }
    return out;
  },
};
export const CASES = 'pd:cases', LESSONS = 'pd:lessons', SETTINGS = 'pd:settings';
export const getPrinters = async () => (await db.get(SETTINGS, 'printers')) || [];
export const listCases = async () => (await db.all(CASES)).sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
export const listLessons = async () => (await db.all(LESSONS)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

/* ---------- Gemini ---------- */
// Best model first; if it is missing or over its free limit, fall back to the next (all have a free tier).
const models = () => [...new Set([process.env.GEMINI_MODEL, 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-flash-latest'].filter(Boolean))];

export async function gemini({ system, contents, json = false, maxTokens = 8192 }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set in Vercel.');
  let lastErr = new Error('No AI model available.');
  for (const model of models()) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents,
        generationConfig: {
          temperature: json ? 0.2 : 0.4,
          maxOutputTokens: maxTokens,
          ...(json ? { responseMimeType: 'application/json' } : {}),
        },
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 404) { lastErr = new Error('AI model not found: ' + model); continue; }
    if (r.status === 429) { lastErr = Object.assign(new Error('Free AI limit reached for now. Try again in a minute (or tomorrow if the daily limit is used up).'), { status: 429 }); continue; }
    if (!r.ok) throw new Error(data?.error?.message || 'AI error ' + r.status);
    const cand = data.candidates?.[0];
    const text = (cand?.content?.parts || []).filter(p => !p.thought && p.text).map(p => p.text).join('');
    if (!text) throw new Error(cand?.finishReason === 'SAFETY' ? 'The AI would not answer that. Try different words.' : 'No answer came back. Try again.');
    return { text, truncated: cand.finishReason === 'MAX_TOKENS', model };
  }
  throw lastErr;
}

// Our chat turns -> Gemini "contents" (roles must alternate, start with user). Images go on the last user turn.
export function toContents(turns, images = []) {
  const out = [];
  for (const t of turns) {
    const role = t.role === 'assistant' ? 'model' : 'user';
    if (!out.length && role === 'model') continue;
    const last = out[out.length - 1];
    if (last && last.role === role) last.parts[0].text += '\n\n' + t.content;
    else out.push({ role, parts: [{ text: t.content }] });
  }
  const lastUser = [...out].reverse().find(c => c.role === 'user');
  if (lastUser) for (const i of images) lastUser.parts.push({ inline_data: { mime_type: i.mime, data: i.data } });
  return out;
}

// Lessons for this printer first, then general ones, so advice from other printers doesn't crowd it out.
export function pickLessons(lessons, printer) {
  const p = String(printer || '').trim().toLowerCase();
  if (!p) return lessons;
  const mine = lessons.filter(l => (l.printer || '').trim().toLowerCase() === p);
  const rest = lessons.filter(l => !mine.includes(l));
  return [...mine, ...rest];
}

export function systemPrompt({ c, lessons, recent, printers }) {
  lessons = pickLessons(lessons, c.printer);
  const worked = lessons.filter(l => l.kind === 'worked').slice(0, 40).map(l => '- ' + l.text).join('\n') || '(none yet)';
  const failed = lessons.filter(l => l.kind === 'failed').slice(0, 30).map(l => '- ' + l.text).join('\n') || '(none yet)';
  const past = recent.map(x => `- [${x.status}] ${x.printer || 'unknown printer'}: ${x.title}${x.lesson ? ' → ' + x.lesson : ''}`).join('\n') || '(none yet)';
  const first = c.turns.length <= 1;
  return `You are Print Doctor: a private, expert helper for a small 3D printing and sublimation business. You fix problems with ANY printer: FDM (Bambu Lab incl. AMS, Prusa, Creality, Elegoo, Anycubic, Voron, Klipper/Marlin), resin (MSLA), sublimation and inkjet printers, heat presses and mug presses. You also know slicers (Bambu Studio, OrcaSlicer, PrusaSlicer, Cura), filaments, resins, sublimation paper/ink, firmware and error codes.

How to think: look closely at every photo. A photo can be the real print (check layer lines, stringing, gaps, warping, blobs, colours) or a screen/app/slicer screenshot (read the text, error code and settings exactly). Think through all likely causes, then pick the most likely. Check the owner's history below: if a past fix matches, say so. NEVER suggest first a fix that is listed under "did NOT work" for the same printer and problem — try a different cause.

How to answer — VERY plain, easy words. No hard terms (if you must use one, explain it in a few words). Short. Use this shape:
**What's wrong:** 1–2 lines. Then how sure you are: Sure / Likely / Best guess.
**Why it happens:** 1–2 lines.
**Fix it:** numbered steps, easiest and most likely first. Give exact numbers (temps, speeds, setting names, where to tap) when useful.
**How to check:** how to know it's fixed.
If something important is missing or the photo is unclear, still give your best guess, then ask ONE short question at the end.
Warn about heat, electricity or fumes when it matters. Never invent error codes or settings — if you don't know, say so.
${first ? 'This is the first reply: the VERY FIRST line must be "TITLE: " followed by a 3–6 word name for this problem. Then the answer.' : 'Do not write a TITLE line.'}

Printer for this problem: ${c.printer || 'not said — ask if it matters'}
Owner's printers: ${printers.join(', ') || 'not listed'}

What WORKED before:
${worked}

What did NOT work before:
${failed}

Recent past problems:
${past}`;
}
