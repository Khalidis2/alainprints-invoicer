import { checkAuth, db, CASES, LESSONS, SETTINGS, listCases, listLessons, getPrinters, gemini, newId } from './_pd-lib.js';

export default async function handler(req, res) {
  if (!(await checkAuth(req, res))) return;
  try {
    if (req.method === 'GET') {
      if (req.query.case) {
        const c = await db.get(CASES, req.query.case);
        return c ? res.json({ case: c }) : res.status(404).json({ error: 'Not found' });
      }
      const [cases, lessons, printers] = await Promise.all([listCases(), listLessons(), getPrinters()]);
      return res.json({
        cases: cases.slice(0, 100).map(({ id, title, printer, status, lesson, updated_at }) => ({ id, title, printer, status, lesson, updated_at })),
        lessons: lessons.slice(0, 200).map(({ id, kind, text, printer, created_at }) => ({ id, kind, text, printer, created_at })),
        printers,
      });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Not allowed' });
    const { action, id, worked, printers } = req.body || {};

    if (action === 'verdict') {
      const c = await db.get(CASES, id);
      if (!c) return res.status(404).json({ error: 'Not found' });
      const convo = (c.turns || []).slice(-10).map(t => `${t.role === 'user' ? 'OWNER' : 'HELPER'}: ${t.content}`).join('\n\n').slice(-12000);
      const ask = worked
        ? 'Below is a printer troubleshooting chat. The owner says the fix WORKED. Write ONE short, plain sentence to remember next time: printer, problem, and the exact fix that worked.'
        : 'Below is a printer troubleshooting chat. The owner says the LAST suggested fix did NOT work. Write ONE short, plain sentence to remember next time: printer, problem, and what was tried that did NOT fix it.';
      let lesson = '';
      try {
        const { text } = await gemini({
          contents: [{ role: 'user', parts: [{ text: `${ask} Reply with only JSON like {"lesson":"Bambu A1 + PETG: stringing fixed by drying filament 65°C for 6h"}.\n\nPrinter: ${c.printer || 'unknown'}\n\n${convo}` }] }],
          json: true, maxTokens: 2048,
        });
        let v; try { v = JSON.parse(text); } catch { v = JSON.parse((text.match(/\{[\s\S]*\}/) || ['{}'])[0]); }
        lesson = String(v.lesson || '').slice(0, 240);
      } catch {}
      if (!lesson) lesson = `${c.printer || 'Printer'}: ${c.title} — ${worked ? 'fixed (see chat)' : 'last fix did not work'}.`;
      const kind = worked ? 'worked' : 'failed';
      const lid = newId();
      await db.set(LESSONS, lid, { id: lid, kind, text: lesson, printer: c.printer || '', case_id: c.id, created_at: new Date().toISOString() });
      c.status = worked ? 'fixed' : 'notfixed';
      if (worked) c.lesson = lesson;
      c.updated_at = Date.now();
      await db.set(CASES, c.id, c);
      return res.json({ ok: true, kind, lesson });
    }

    if (action === 'deleteCase') {
      await db.del(CASES, id);
      return res.json({ ok: true });
    }

    if (action === 'deleteLesson') {
      await db.del(LESSONS, id);
      return res.json({ ok: true });
    }

    if (action === 'printers') {
      const list = (Array.isArray(printers) ? printers : []).map(p => String(p).slice(0, 80)).slice(0, 30);
      await db.set(SETTINGS, 'printers', list);
      return res.json({ ok: true, printers: list });
    }

    res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
}
