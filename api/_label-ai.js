import { env } from "./_stripe-shared.js";

// Reads a photo of a filament box / spool label with an AI vision model and says which filament it is.
// Used by the Stock tab's "Scan label" (admin only). Photos are not stored.
// 1) Groq (GROQ_API_KEY): the usual vision models first, then any vision-capable model the account lists.
// 2) Gemini (GEMINI_API_KEY, optional): backup if Groq has no working vision model or is over its limit.
const GROQ_MODELS = [env("GROQ_VISION_MODEL"), "meta-llama/llama-4-scout-17b-16e-instruct", "meta-llama/llama-4-maverick-17b-128e-instruct"].filter(Boolean);
const GEMINI_MODELS = [env("GEMINI_VISION_MODEL"), "gemini-2.5-flash", "gemini-flash-latest", "gemini-2.5-flash-lite"].filter(Boolean);
const GROQ_BASE = env("GROQ_API_BASE") || "https://api.groq.com/openai/v1";
const GEMINI_BASE = env("GEMINI_API_BASE") || "https://generativelanguage.googleapis.com/v1beta";
const norm = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9+]+/g, " ").trim();

export class LabelError extends Error {
  constructor(message, status = 502, detail = "") {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

// The model that worked last time is tried first.
let workingGroq = "";
let workingGemini = "";

// Groq changes its model list over time: ask which chat models this account can use, vision-looking names first.
async function listGroqModels(key) {
  try {
    const response = await fetch(`${GROQ_BASE}/models`, { headers: { Authorization: `Bearer ${key.trim()}` }, signal: AbortSignal.timeout(6000) });
    if (!response.ok) return [];
    const data = await response.json().catch(() => ({}));
    return (data?.data || []).map((model) => String(model.id)).filter((id) => !/(whisper|tts|guard|embed|playai|orpheus|moderation|safeguard|transcri)/i.test(id));
  } catch {
    return [];
  }
}
const visionScore = (id) => (/(vision|-vl|vl-|llava|pixtral)/i.test(id) ? 0 : /(llama-4|scout|maverick|gemma-3|qwen)/i.test(id) ? 1 : 2);

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

// Finish words that make a different filament. If the label says one of these and the stock name does not,
// it is a new filament, not the plain colour that happens to share the type and colour name.
const FINISH_WORDS = ["translucent", "glow", "luminous", "fluorescent", "neon", "metallic", "glitter", "sparkle", "carbon", "wood", "marble", "silk", "tricolor", "matte", "rapid", "hs", "galaxy", "rainbow", "gradient", "dual", "glossy", "cf"];
const finishOf = (text) => {
  const words = norm(text).replace(/\btransparent\b|\bsemi transparent\b/g, "translucent").split(" ");
  return FINISH_WORDS.filter((word) => words.includes(word));
};

function buildPrompt(options, known) {
  return `You are reading the label or box of a 3D printing filament spool (usually the brand Kingroon). Read ALL the text on it, including small print, codes and Chinese text.
Reply with ONE JSON object only, with these keys:
- "material": the filament type, for example PLA, PLA+, PLA Matte, PLA HS, PLA Marble, PETG, PETG Matte, Silk Tricolor.
- "color": the colour name in English (translate Chinese colour words; for silk/tricolor list the colours separated by " / ").
- "variant": any special finish printed on the label, for example Translucent, Transparent, Glow in the dark, Matte, Silk, Marble, Metallic, Carbon fiber, Basic, High Speed. Empty string if none.
- "code": the product code if you can see one (for example KR-PLA301Y-1CH), else "".
- "text": the main text you read, one short line.
- "confidence": a number from 0 to 1 for how sure you are about material AND color.
${options.length ? `The shop's stock uses these exact names. Use one of them ONLY if the label says exactly that: same type, same finish and same colour. A translucent, glow, metallic or other special finish is a DIFFERENT filament from the plain colour, so do not map it to a plain colour. If nothing matches exactly, this is a NEW filament: write the type and colour exactly as the label says (for example material "PETG Translucent", color "Blue"). Never pick the nearest name just to match. Stock names:\n${options.map((o) => `${o.material} | ${o.color}`).join("\n")}\n` : ""}${known.length ? `Label codes the shop already knows:\n${known.join("\n")}\n` : ""}If the photo is not a filament label, use empty strings and confidence 0. Never guess a colour you cannot see or read.`;
}

export async function readLabel(input) {
  const groqKey = env("GROQ_API_KEY");
  const geminiKey = env("GEMINI_API_KEY");
  if (!groqKey && !geminiKey) throw new LabelError("The AI reader needs GROQ_API_KEY (or GEMINI_API_KEY) in the invoicer's Vercel settings.", 503);
  const image = typeof input?.image === "string" ? input.image : "";
  const parsedImage = image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!parsedImage || image.length > 3_500_000) throw new LabelError("Send one photo (JPEG, PNG or WebP, under about 2.5 MB).", 400);
  const options = cleanOptions(input?.options);
  const known = input?.known && typeof input.known === "object"
    ? Object.entries(input.known).slice(0, 80).map(([code, target]) => `${String(code).slice(0, 40)} = ${String(target?.material || "").slice(0, 40)} ${String(target?.color || "").slice(0, 60)}`)
    : [];
  const prompt = buildPrompt(options, known);
  const problems = [];

  const shape = (result) => {
    const material = String(result.material || "").trim().slice(0, 40);
    const color = String(result.color || "").trim().slice(0, 80);
    const variant = String(result.variant || "").trim().slice(0, 60);
    const text = String(result.text || "").trim().slice(0, 160);
    // The whole line the model read counts too, so a finish word it forgot to put in "variant" still makes this a new filament.
    const wanted = finishOf(`${material} ${color} ${variant} ${text}`);
    const sameName = options.find((o) => norm(o.material) === norm(material) && norm(o.color) === norm(color)) || null;
    // Every finish word on the label must also be in the stock name, and the other way round.
    const match = sameName && JSON.stringify(finishOf(`${sameName.material} ${sameName.color}`).sort()) === JSON.stringify([...wanted].sort()) ? sameName : null;
    // A new finish that the model only put in "variant" belongs in the type name, e.g. "PETG" + Translucent.
    const named = finishOf(`${material} ${color}`);
    const missing = wanted.filter((word) => !named.includes(word));
    const addon = variant && !norm(material).includes(norm(variant)) ? variant : missing.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
    const newType = !match && missing.length && addon ? `${material} ${addon}`.trim().slice(0, 40) : material;
    return {
      variant,
      material: match?.material || newType,
      color: match?.color || color,
      code: String(result.code || "").trim().slice(0, 60),
      text,
      confidence: Math.max(0, Math.min(1, Number(result.confidence) || 0)),
      matched: Boolean(match),
    };
  };
  const failure = (label, response, body) => problems.push(`${label}: ${response.status} ${String(body?.error?.message || body?.error || "").slice(0, 140)}`);

  const askGroq = async (model) => {
    try {
      const response = await fetch(`${GROQ_BASE}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey.trim()}` },
        body: JSON.stringify({ model, temperature: 0.1, max_tokens: 500, messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: image } }] }] }),
        signal: AbortSignal.timeout(25000),
      });
      if (!response.ok) { failure(model, response, await response.json().catch(() => ({}))); return null; }
      const data = await response.json().catch(() => ({}));
      const result = parseJson(data?.choices?.[0]?.message?.content);
      if (!result) { problems.push(`${model}: answer was not JSON`); return null; }
      workingGroq = model;
      return shape(result);
    } catch (error) {
      problems.push(`${model}: ${error.name === "TimeoutError" ? "timed out" : "network error"}`);
      return null;
    }
  };

  const askGemini = async (model) => {
    try {
      const response = await fetch(`${GEMINI_BASE}/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey.trim() },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }, { inline_data: { mime_type: parsedImage[1], data: parsedImage[2] } }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 500, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
        }),
        signal: AbortSignal.timeout(25000),
      });
      if (!response.ok) { failure(`gemini ${model}`, response, await response.json().catch(() => ({}))); return null; }
      const data = await response.json().catch(() => ({}));
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const result = parseJson(parts.filter((part) => part.text && !part.thought).map((part) => part.text).join(""));
      if (!result) { problems.push(`gemini ${model}: answer was not JSON`); return null; }
      workingGemini = model;
      return shape(result);
    } catch (error) {
      problems.push(`gemini ${model}: ${error.name === "TimeoutError" ? "timed out" : "network error"}`);
      return null;
    }
  };

  const stopper = /^(401|403|429) /;
  let available = [];
  // ---- Groq ----
  if (groqKey) {
    const first = [workingGroq, ...GROQ_MODELS].filter((model, index, list) => model && list.indexOf(model) === index);
    for (const model of first) {
      const result = await askGroq(model);
      if (result) return result;
      if (stopper.test((problems.at(-1) || "").split(": ")[1] || "")) break; // a bad key or a limit is not fixed by another model
    }
    if (!problems.some((line) => / (401|403|429) /.test(line))) {
      available = await listGroqModels(groqKey);
      const extra = available.filter((id) => !first.includes(id)).sort((a, b) => visionScore(a) - visionScore(b)).slice(0, 5);
      for (const model of extra) {
        const result = await askGroq(model); // a model that cannot see images answers 400 straight away
        if (result) return result;
      }
    }
  }
  // ---- Gemini backup ----
  if (geminiKey) {
    const models = [workingGemini, ...GEMINI_MODELS].filter((model, index, list) => model && list.indexOf(model) === index);
    for (const model of models) {
      const result = await askGemini(model);
      if (result) return result;
    }
  }

  const text = problems.join(" | ");
  const badKey = / (401|403) /.test(text);
  const limited = / 429 /.test(text);
  const listing = available.length ? `Groq models on this account: ${available.slice(0, 25).join(", ")}` : "";
  const detail = `${listing}${listing ? " || " : ""}${text}`.slice(0, 900);
  throw new LabelError(
    badKey ? "The AI refused the key. Check the key in the invoicer's Vercel settings." : limited ? "The AI's free limit is used up for now. Try again in a minute." : "The AI could not read that photo. Try again with the label closer and well lit.",
    badKey ? 503 : limited ? 429 : 502,
    detail,
  );
}
