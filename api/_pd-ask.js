import { checkAuth, db, CASES, listCases, listLessons, getPrinters, gemini, systemPrompt, toContents, newId, stripTitle } from './_pd-lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!(await checkAuth(req, res))) return;
  try {
    const { caseId, text = '', images = [], printer = '' } = req.body || {};
    const imgs = (Array.isArray(images) ? images : []).slice(0, 4)
      .filter(i => i && /^image\/(jpeg|png|webp)$/.test(i.mime) && typeof i.data === 'string');

    let c;
    if (caseId) {
      c = await db.get(CASES, caseId);
      if (!c) return res.status(404).json({ error: 'Problem not found' });
    } else {
      c = { id: newId(), title: 'New problem', printer: String(printer).slice(0, 80), status: 'open', lesson: null, turns: [], created_at: Date.now() };
    }

    const n = imgs.length;
    c.turns.push({
      role: 'user',
      content: (String(text).trim() || 'Please look at the photo and tell me what is wrong.') + (n ? `\n[${n} photo${n > 1 ? 's' : ''} attached]` : ''),
      at: Date.now(),
    });
    c.status = 'open';

    const [lessons, allCases, printers] = await Promise.all([
      listLessons().then(l => l.slice(0, 200)),
      listCases(),
      getPrinters(),
    ]);
    const recent = allCases.filter(x => x.id !== c.id).slice(0, 12);

    const system = systemPrompt({ c, lessons, recent, printers });
    const { text: out, truncated } = await gemini({ system, contents: toContents(c.turns.slice(-16), imgs) });

    const m = out.match(/^\s*\**TITLE:\s*(.+)/i);
    if (m && c.title === 'New problem') c.title = m[1].replace(/[*#]/g, '').trim().slice(0, 60);
    c.turns.push({ role: 'assistant', content: stripTitle(out) + (truncated ? '\n\n(Answer was cut short — say "continue".)' : ''), at: Date.now() });
    c.updated_at = Date.now();

    await db.set(CASES, c.id, c);
    res.json({ case: c });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
}
