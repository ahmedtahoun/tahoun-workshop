// Homepage AI assistant endpoints (port of api/agent-token.php and api/lead.php).
//   GET  /api/agent-token.php?mode=voice|text  short-lived ElevenLabs credential (the key never reaches the browser)
//   POST /api/lead.php                          saves a lead and pings Ahmed on Telegram
//   GET  /api/leads.csv?key=ADMIN_KEY           all homepage leads (new: on cPanel they were only a server file)
import { h, json, csv, safeEqual, sha256Hex } from "./mail.js";

const ALLOWED = ["https://tahoun.wheretospot.com", "https://tahoun.wheretospot.workers.dev"];

// Only answer requests made by the site itself.
function sameSite(request) {
  const origin = request.headers.get("Origin") ?? "";
  const referer = request.headers.get("Referer") ?? "";
  const site = request.headers.get("Sec-Fetch-Site") ?? "";
  const isLocal = (u) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u);
  for (const u of [origin, referer]) {
    if (!u) continue;
    if (isLocal(u) || ALLOWED.some((a) => u.startsWith(a))) return true;
  }
  return !origin && !referer && site === "same-origin";
}

// Counts events per key per UTC day. Returns false once the limit is reached.
async function rateOk(db, bucket, key, limit) {
  const day = new Date().toISOString().slice(0, 10);
  const hash = (await sha256Hex(key + day)).slice(0, 16); // no raw IPs stored
  let ok = false;
  db.edit("hrate", (data) => {
    const b = data[bucket]?.day === day ? data[bucket] : { day, counts: {} };
    const n = b.counts[hash] ?? 0;
    ok = n < limit;
    if (ok) b.counts[hash] = n + 1;
    data[bucket] = b;
    return data;
  });
  return ok;
}

const ip = (request) => request.headers.get("CF-Connecting-IP") ?? "0.0.0.0";

export async function agentToken(request, env, db, url) {
  if (request.method !== "GET") return json({ error: "method" }, 405);
  if (!sameSite(request)) return json({ error: "forbidden" }, 403);
  if (!env.ELEVENLABS_API_KEY || !env.ELEVENLABS_AGENT_ID) return json({ error: "not_configured" }); // the site falls back to its offline assistant
  if (!(await rateOk(db, "session-ip", ip(request), Number(env.SESSIONS_PER_IP_PER_DAY ?? 6)))) return json({ error: "limit_visitor" }, 429);
  if (!(await rateOk(db, "session-all", "all", Number(env.SESSIONS_PER_DAY ?? 60)))) return json({ error: "limit_daily" }, 429);
  const mode = url.searchParams.get("mode") === "text" ? "text" : "voice";
  const agent = encodeURIComponent(env.ELEVENLABS_AGENT_ID);
  const endpoint = mode === "voice"
    ? `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${agent}`
    : `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agent}`;
  let code = 0, body = {};
  try {
    const r = await fetch(endpoint, { headers: { "xi-api-key": env.ELEVENLABS_API_KEY }, signal: AbortSignal.timeout(12000) });
    code = r.status;
    body = await r.json().catch(() => ({}));
  } catch { /* upstream unreachable */ }
  if (code === 200 && mode === "voice" && body.token) return json({ conversationToken: body.token });
  if (code === 200 && mode === "text" && body.signed_url) return json({ signedUrl: body.signed_url });
  // Pass on ElevenLabs' short error code for setup checks; never the key.
  const d = body.detail ?? {};
  const reason = typeof d === "object" ? String(d.status ?? d.code ?? "") : "";
  return json({ error: "upstream", status: code, reason: reason.slice(0, 40).replace(/[^a-z0-9_]/gi, "") }, 502);
}

const clean = (v, max = 300, multiline = false) => {
  const s = typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : "";
  return [...s.replace(multiline ? /[\x00-\x09\x0B-\x1F\x7F]+/g : /[\x00-\x1F\x7F]+/g, " ").trim()].slice(0, max).join("").trim();
};

async function telegram(env, textMsg) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      body: new URLSearchParams({ chat_id: env.TELEGRAM_CHAT_ID, text: [...textMsg].slice(0, 4000).join(""), parse_mode: "HTML", disable_web_page_preview: "true" }),
      signal: AbortSignal.timeout(10000),
    });
    return r.status === 200;
  } catch { return false; }
}

export async function lead(request, env, db) {
  if (request.method !== "POST") return json({ error: "method" }, 405);
  if (!sameSite(request)) return json({ error: "forbidden" }, 403);
  let input;
  try { input = JSON.parse((await request.text()).slice(0, 40000)); } catch { input = null; }
  if (!input || typeof input !== "object") return json({ error: "bad_json" }, 400);
  if (input.website) return json({ ok: true }); // honeypot
  if (!(await rateOk(db, "lead-ip", ip(request), Number(env.LEADS_PER_IP_PER_DAY ?? 10)))) return json({ error: "limit" }, 429);
  const L = {
    at: new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00"),
    name: clean(input.name, 120), email: clean(input.email, 160), phone: clean(input.phone, 40), company: clean(input.company, 160), role: clean(input.role, 160),
    visitor_type: clean(input.visitor_type, 40), interest: clean(input.interest, 500), timeline: clean(input.timeline, 120), budget: clean(input.budget, 120),
    location: clean(input.location, 120), notes: clean(input.notes, 1500, true), meeting: clean(input.meeting, 200), lang: clean(input.lang, 5), mode: clean(input.mode, 20),
    conversation_id: clean(input.conversation_id, 80), transcript: clean(input.transcript, 6000, true),
  };
  if (L.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(L.email)) L.email = "";
  if (!L.name && !L.email && !L.phone && !L.transcript) return json({ error: "empty" }, 422);
  db.edit("homeleads", (arr) => { arr.push(L); return arr; });

  const type = { recruiter: "🧑‍💼 Recruiter / hiring", client: "🛠️ Client project", other: "👋 Visitor" }[L.visitor_type] ?? "👋 Visitor";
  const lines = ["<b>🔔 New lead from your AI assistant</b>", type];
  for (const [k, label] of Object.entries({ name: "Name", email: "Email", phone: "Phone", company: "Company", role: "Role", interest: "Wants", timeline: "Timeline", budget: "Budget", location: "Location", meeting: "📅 Meeting", notes: "Notes" })) {
    if (L[k]) lines.push(`<b>${label}:</b> ` + h(L[k]));
  }
  lines.push("<i>" + h((L.lang || "en").toUpperCase() + " · " + (L.mode || "chat")) + "</i>");
  if (L.conversation_id) lines.push('<a href="https://elevenlabs.io/app/agents/history/' + encodeURIComponent(L.conversation_id) + '">Open the full conversation</a>');
  if (L.transcript) lines.push("\n<b>Transcript</b>\n" + h([...L.transcript].slice(0, 2200).join("")));
  const sent = await telegram(env, lines.join("\n"));
  return json({ ok: true, notified: sent });
}

export function leadsCsv(env, db, url) {
  const key = url.searchParams.get("key") ?? "";
  if (!key || !env.ADMIN_KEY || !safeEqual(key, env.ADMIN_KEY)) return json({ ok: false, error: "Not allowed." }, 403);
  const cols = ["at", "name", "email", "phone", "company", "role", "visitor_type", "interest", "timeline", "budget", "location", "meeting", "notes", "lang", "mode", "conversation_id", "transcript"];
  return csv([cols, ...db.load("homeleads").map((l) => cols.map((c) => l[c] ?? ""))], "tahoun-homepage-leads.csv");
}
