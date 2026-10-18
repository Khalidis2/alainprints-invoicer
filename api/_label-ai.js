import { env } from "./_stripe-shared.js";

// Reads a photo of a filament box / spool label with Groq's free vision model and says which filament it is.
// Used by the Stock tab's "Scan label" (admin only). Photos are not stored.
const MODELS = [env("GROQ_VISION_MODEL"), "meta-llama/llama-4-scout-17b-16e-instruct", "meta-llama/llama-4-maverick-17b-128e-instruct"].filter(Boolean);
const BASE = env("GROQ_API_BASE") || "https://api.groq.com/openai/v1";
const norm = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9+]+/g, " ").trim();

export class LabelError extends Error {
  constructor(message, status = 502, detail = "") {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

// The model that worked last time is tried first.
let workingModel = "";

// Groq changes its model list over time. If the usual models fail, ask Groq which vision-capable ones exist.
async function discoverModels(key) {
  try {
    const response = await fetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${key.trim()}` }, signal: AbortSignal.timeout(6000) });
    if (!response.ok) return [];
    const data = await response.json().catch(() => ({}));
    return (data?.data || []).map((model) => String(model.id)).filter((id) => /(vision|llama-4|scout|maverick|llava|pixtral|-vl)/i.test(id));
  } catch {
    return [];
  }
}

// Finds the JSON object in the model's answer even if it adds words around it.
function parseJson(text) {
  const raw = String(text || "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

function cleanOptions(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 200).map((raw) => ({ material: String(raw?.material || "").trim().slice(0, 40), color: String(raw?.color || "").trim().slice(0, 60) })).filter((o) => o.material && o.color);
}

export async function readLabel(input) {
  const key = env("GROQ_API_KEY");
  if (!key) throw new LabelError("The AI reader needs GROQ_API_KEY in the invoicer's Vercel settings.", 503);
  const image = typeof input?.image === "string" ? input.image : "";
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > 3_500_000) throw new LabelError("Send one photo (JPEG, PNG or WebP, under about 2.5 MB).", 400);
  const options = cleanOptions(input?.options);
  const known = input?.known && typeof input.known === "object"
    ? Object.entries(input.known).slice(0, 80).map(([code, target]) => `${String(code).slice(0, 40)} = ${String(target?.material || "").slice(0, 40)} ${String(target?.color || "").slice(0, 60)}`)
    : [];

  const prompt = `You are reading the label or box of a 3D printing filament spool (usually the brand Kingroon). Read ALL the text on it, including small print, codes and Chinese text.
Reply with ONE JSON object only, with these keys:
- "material": the filament type, for example PLA, PLA+, PLA Matte, PLA HS, PLA Marble, PETG, PETG Matte, Silk Tricolor.
- "color": the colour name in English (translate Chinese colour words; for silk/tricolor list the colours separated by " / ").
- "code": the product code if you can see one (for example KR-PLA301Y-1CH), else "".
- "text": the main text you read, one short line.
- "confidence": a number from 0 to 1 for how sure you are about material AND color.
${options.length ? `The shop's stock uses these exact names. If the label matches one, use its exact spelling:\n${options.map((o) => `${o.material} | ${o.color}`).join("\n")}\n` : ""}${known.length ? `Label codes the shop already knows:\n${known.join("\n")}\n` : ""}If the photo is not a filament label, use empty strings and confidence 0. Never guess a colour you cannot see or read.`;

  const problems = [];
  const tryModel = async (model) => {
    try {
      const response = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key.trim()}` },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          max_tokens: 500,
          messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: image } }] }],
        }),
        signal: AbortSignal.timeout(25000),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        problems.push(`${model}: ${response.status} ${String(body?.error?.message || "").slice(0, 140)}`);
        return null;
      }
      const data = await response.json().catch(() => ({}));
      const result = parseJson(data?.choices?.[0]?.message?.content);
      if (!result) { problems.push(`${model}: answer was not JSON`); return null; }
      const material = String(result.material || "").trim().slice(0, 40);
      const color = String(result.color || "").trim().slice(0, 80);
      const match = options.find((o) => norm(o.material) === norm(material) && norm(o.color) === norm(color)) || null;
      workingModel = model;
      return {
        material: match?.material || material,
        color: match?.color || color,
        code: String(result.code || "").trim().slice(0, 60),
        text: String(result.text || "").trim().slice(0, 160),
        confidence: Math.max(0, Math.min(1, Number(result.confidence) || 0)),
        matched: Boolean(match),
      };
    } catch (error) {
      problems.push(`${model}: ${error.name === "TimeoutError" ? "timed out" : "network error"}`);
      return null;
    }
  };

  const first = [workingModel, ...MODELS].filter((model, index, list) => model && list.indexOf(model) === index);
  for (const model of first) {
    const result = await tryModel(model);
    if (result) return result;
    // A bad key or a hit rate limit will not be fixed by another model.
    if (/: (401|403|429) /.test(problems.at(-1) || "")) break;
  }
  if (!problems.some((line) => /: (401|403|429) /.test(line))) {
    for (const model of (await discoverModels(key)).filter((id) => !first.includes(id)).slice(0, 4)) {
      const result = await tryModel(model);
      if (result) return result;
    }
  }
  const limited = problems.some((line) => / 429 /.test(line));
  const badKey = problems.some((line) => / 40[13] /.test(line));
  throw new LabelError(
    badKey ? "Groq refused the key. Check GROQ_API_KEY in the invoicer's Vercel settings." : limited ? "Groq's free limit is used up for now. Try again in a minute." : "The AI could not read that photo. Try again with the label closer and well lit.",
    badKey ? 503 : limited ? 429 : 502,
    problems.join(" | ").slice(0, 400),
  );
}
