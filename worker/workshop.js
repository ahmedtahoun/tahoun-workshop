// Workshop app server (port of workshop/api.php, mail.php, admin.php, unsub.php, cron.php).
// Runs inside the Durable Object, so every read-modify-write is already serialized (no file locks needed).
import { h, p, list, layout, text, send, hmacHex, safeEqual, csv, json, html, cut, validEmail, now, isoNow, waLink } from "./mail.js";

const LEVELS = ["new", "some", "daily"];
const HOURS = { "0-2": 1, "3-5": 4, "6-10": 8, "11-20": 15, "20+": 25 };
const LIMIT = 20; // seconds per game question
const PAUSE = 4; // seconds each player sees their result before the next question

// Game questions: o = options, a = index of the right answer, why = shown after the reveal; t = seconds, x = points multiplier.
const QS = [
  { q: "“Write a post about my yoga studio.” Is this a good brief?", o: ["Good brief", "Bad brief"], a: 1, why: "No who, why, how or don’t. The AI has to guess everything." },
  { q: "“You’re a copywriter. Write a launch email. Under 100 words, no hype.” Which part is missing?", o: ["Who", "Why", "How", "Don’t"], a: 1, why: "Why: the situation only you know. Who is it for, and what are you launching?" },
  { q: "Today’s exchange rate, euro to Egyptian pound. Where should the answer come from?", o: ["AI memory", "Web search", "Deep research"], a: 1, why: "It changes every day. Turn on search and check the source." },
  { q: "Rewrite your email so it sounds warmer. What does the AI need?", o: ["AI memory", "Web search", "Deep research"], a: 0, why: "Writing and rewriting need no search. Your email is the facts." },
  { q: "Compare 5 booking apps for your business before you pay for one.", o: ["AI memory", "Web search", "Deep research"], a: 2, why: "A money decision with many sources: deep research, then read the sources." },
  { q: "The AI says your business plan is brilliant. Best next prompt?", o: ["“Thank you!”", "“List the 3 biggest reasons it could fail.”", "“Make it longer.”"], a: 1, why: "AI tends to agree with you. Ask it to push back." },
  { q: "Safe to paste a client’s name and medical notes into a public AI tool?", o: ["Yes, it’s private", "No, remove personal details first", "Only on weekends"], a: 1, why: "Swap names for [Client A] and leave health details out." },
  { q: "The first answer is okay, not great. What do you do?", o: ["Accept it", "Start a new chat", "Reply with feedback: “Shorter, warmer.”"], a: 2, why: "Never keep the first draft. The conversation is where quality comes from." },
  { q: "You ask the same question twice and get two different answers. Why?", o: ["It’s broken", "It picks likely words, with a little randomness", "It searched the web again", "It learned from your last chat"], a: 1, why: "AI predicts the next likely word, with some chance in each pick. Same question, different wording, so always check.", t: 30, x: 2 },
  { q: "You paste a 40-page report and ask for a summary. Where is AI most likely to miss things?", o: ["The first pages", "The middle pages", "The last pages", "Nowhere, it reads everything equally"], a: 1, why: "Models pay most attention to the start and the end. Ask for a summary section by section.", t: 30, x: 2 },
];

const qlim = (i) => QS[i]?.t ?? LIMIT;
function qpts(i, a) {
  if (!QS[i] || Number(a.c) !== QS[i].a) return 0;
  const lim = qlim(i);
  return Math.round((500 + 500 * (1 - Math.min(a.t, lim) / lim)) * (QS[i].x ?? 1));
}
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

// Make sure this player is in the race and skip questions they ran out of time on. Returns true if g changed.
function gameTick(g, pid, t) {
  if (g.phase !== "open" || !pid) return false;
  const n = QS.length;
  let changed = false;
  g.prog ??= {}; g.answers ??= {};
  if (!g.prog[pid]) {
    const start = Number(g.startedAt ?? t);
    g.prog[pid] = { q: 0, at: t - start > qlim(0) ? t : start }; // late joiners get a full first question
    changed = true;
  }
  const pr = g.prog[pid];
  while (pr.q < n && t >= pr.at && t - pr.at > qlim(pr.q) + 1.5) {
    (g.answers[pr.q] ??= {})[pid] = { c: -1, t: qlim(pr.q) };
    pr.at = pr.at + qlim(pr.q) + 1.5 + PAUSE;
    pr.q++;
    changed = true;
  }
  return changed;
}
function gameTickAll(g, t) {
  let changed = false;
  for (const id of Object.keys(g.prog ?? {})) if (gameTick(g, id, t)) changed = true;
  return changed;
}
// End the game once every player has finished and seen their last result.
function gameAutodone(g, t) {
  if (g.phase !== "open" || !g.prog || !Object.keys(g.prog).length) return false;
  for (const pr of Object.values(g.prog)) if (pr.q < QS.length || t < pr.at) return false;
  g.phase = "done"; g.endedAt = t;
  return true;
}
function gamePoints(g) {
  const pts = {};
  for (const [q, ans] of Object.entries(g.answers ?? {})) for (const [pid, a] of Object.entries(ans)) pts[pid] = (pts[pid] ?? 0) + qpts(Number(q), a);
  return pts;
}
// Most points first; on a tie, less total answer time wins.
function gameRank(g) {
  const rows = {};
  for (const [pid, pr] of Object.entries(g.prog ?? {})) rows[pid] = { pts: 0, time: 0, q: Number(pr.q), right: 0 };
  for (const [q, ans] of Object.entries(g.answers ?? {})) for (const [pid, a] of Object.entries(ans)) {
    rows[pid] ??= { pts: 0, time: 0, q: 0, right: 0 };
    const pts = qpts(Number(q), a);
    rows[pid].pts += pts; rows[pid].time += Number(a.t);
    if (pts > 0) rows[pid].right++;
  }
  return Object.entries(rows).sort(([, a], [, b]) => b.pts - a.pts || a.time - b.time);
}

function gameView(g, pid, people) {
  const t = now();
  const gp = g.phase ?? "idle";
  const n = QS.length;
  const v = { g: gp, phase: gp, total: n, players: Object.keys(g.prog ?? {}).length, limit: qlim(0) };
  if (gp === "idle") return v;
  v.finished = Object.values(g.prog ?? {}).filter((pr) => pr.q >= n).length;
  const board = []; let i = 0, rank = 0;
  for (const [id, r] of gameRank(g)) {
    i++;
    if (id === pid) { rank = i; v.myScore = r.pts; v.myTime = round(r.time, 1); v.myRight = r.right; }
    if (board.length < 10) {
      const cc = people[id]?.country ?? "";
      board.push({ name: people[id] ? people[id].name : "Guest", country: cc === "XX" ? "" : cc, points: r.pts, time: round(r.time, 1), q: Math.min(r.q, n), me: id === pid });
    }
  }
  v.rank = rank; v.board = board;
  if (pid && v.myScore === undefined) v.myScore = 0;
  if (gp === "done" || !pid || !g.prog?.[pid]) return v;
  const pr = g.prog[pid];
  let streak = 0;
  for (let k = pr.q - 1; k >= 0; k--) { if (qpts(k, g.answers?.[k]?.[pid] ?? { c: -1, t: 0 }) > 0) streak++; else break; }
  v.streak = streak;
  if (pr.q > 0 && t < pr.at) {
    const q = pr.q - 1;
    const a = g.answers?.[q]?.[pid] ?? { c: -1, t: qlim(q) };
    Object.assign(v, { phase: "reveal", q, question: QS[q].q, options: QS[q].o, correct: QS[q].a, why: QS[q].why,
      mine: Number(a.c) >= 0 ? Number(a.c) : null, myT: a.t, gained: qpts(q, a), hard: !!QS[q].x, next: Math.max(0, pr.at - t), last: pr.q >= n });
    return v;
  }
  if (pr.q === 0 && t < pr.at) { v.phase = "countdown"; v.q = 0; v.next = pr.at - t; return v; }
  if (pr.q >= n) { v.phase = "finished"; v.q = n; return v; }
  const q = pr.q;
  Object.assign(v, { phase: "open", q, question: QS[q].q, options: QS[q].o, limit: qlim(q), remaining: Math.max(0, qlim(q) - (t - pr.at)), hard: !!QS[q].x });
  return v;
}

const pidOf = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const randHex = (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

// ---------------------------------------------------------------------------------------------------------
// Email sequence. who: which tick box a person needs ('' = everyone with an email).
// at: [days after the event, "HH:MM" Cairo time], or "now".
export const TYPES = {
  welcome: { label: "Welcome (at check-in)", who: "", at: "now" },
  slides: { label: "Slides and prompts (day +1)", who: "handout", at: [1, "10:00"] },
  call: { label: "Book your free call (day +2)", who: "call", at: [2, "10:00"] },
  day3: { label: "Challenge, day 3 (day +3)", who: "handout", at: [3, "19:00"] },
  course: { label: "AI Launchpad course (day +4)", who: "course", at: [4, "10:00"] },
  day7: { label: "Challenge, day 7 (day +7)", who: "handout", at: [7, "10:00"] },
};

// Seconds since epoch for a Cairo local date+time.
function cairoTime(dateStr, hhmm, addDays) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d + addDays, hh, mm);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const asCairo = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return (guess - (asCairo - guess)) / 1000;
}
function due(env, at) {
  const t = Math.floor(now());
  if (at === "now") return t;
  return Math.max(cairoTime(env.EVENT_DATE, at[1], at[0]), t + 60); // someone joining late still gets it, a minute later
}
function mailCfg(db) {
  const c = db.load("mailcfg");
  for (const k of Object.keys(TYPES)) if (c[k] === undefined) c[k] = true;
  return c;
}
const wants = (r, who) => !!r.email && !r.unsub && (who === "" ? true : !!r.wants?.[who]);

// Queue every email this person qualifies for and doesn't have yet. Safe to call on every check-in.
function enqueue(env, db, r) {
  if (!r.email) return;
  const t = Math.floor(now());
  db.edit("mailq", (q) => {
    for (const [type, tp] of Object.entries(TYPES)) {
      const key = r.id + ":" + type;
      if (q[key] || !wants(r, tp.who)) continue;
      q[key] = { pid: r.id, type, due: due(env, tp.at), status: "queued", tries: 0, added: t };
    }
    return q;
  });
}

// Send what is due. Consent is checked again at send time, so unticking or unsubscribing stops later emails.
export async function processMail(env, db, limit = 40, onlyPid = null) {
  const people = db.load("checkins");
  const cfg = mailCfg(db);
  const t = Math.floor(now());
  db.edit("mailq", (q) => { for (const it of Object.values(q)) if (it.status === "sending" && (it.claimedAt ?? 0) < t - 600) it.status = "queued"; return q; });
  const todo = [];
  for (const [key, it] of Object.entries(db.load("mailq"))) {
    if (it.status !== "queued" || it.due > t) continue;
    if (onlyPid !== null && it.pid !== onlyPid) continue;
    todo.push([key, it]);
    if (todo.length >= limit) break;
  }
  let sent = 0, skipped = 0, failed = 0;
  for (const [key, it] of todo) {
    const r = people[it.pid];
    let result = null;
    if (!r || !TYPES[it.type] || !wants(r, TYPES[it.type].who)) { result = { status: "skipped", note: "no longer wanted" }; skipped++; }
    else if (!cfg[it.type]) { result = { status: "skipped", note: "turned off in admin" }; skipped++; }
    else if (!env.BREVO_API_KEY) continue; // wait for the key; nothing is lost
    else {
      let claimed = false;
      db.edit("mailq", (q) => { if (q[key]?.status === "queued") { q[key].status = "sending"; q[key].claimedAt = t; claimed = true; } return q; });
      if (!claimed) continue;
      const m = await render(env, it.type, r);
      const res = await send(env, r.email, r.name, m.subject, m.html, m.text);
      if (res.ok) { result = { status: "sent", sentAt: t }; sent++; }
      else {
        const tries = it.tries + 1;
        result = tries >= 3 ? { status: "failed", tries, note: res.error } : { status: "queued", tries, due: t + 900, note: res.error };
        failed++;
      }
    }
    db.edit("mailq", (q) => { if (q[key]) Object.assign(q[key], result); return q; });
  }
  return { sent, skipped, failed, waiting: !env.BREVO_API_KEY };
}

const unsubUrl = async (env, pid) => env.SITE_URL + "unsub.php?u=" + encodeURIComponent(pid) + "&t=" + (await hmacHex(env.ADMIN_KEY, "unsub:" + pid));

async function render(env, type, r) {
  const n = h(r.name || "there");
  const app = env.SITE_URL;
  const wa = waLink(env);
  const rated = !!r.fb;
  const c = { label: "Free workshop · Dahab", why: "You get this because you checked in at " + env.EVENT_NAME + " and asked for it.", unsub: await unsubUrl(env, r.id) };
  switch (type) {
    case "welcome":
      Object.assign(c, { title: `You're in, ${n}!`, pre: "Your workshop app: slides, prompt builder, live game and your kit.",
        body: p("Welcome to <b>Brief Your AI</b>, the free AI workshop in Dahab. Keep this email: your workshop app is one tap away, during the session and after it.")
          + list(["<b>Slides</b> for every part, as we go", "<b>Prompt builder</b> for the exercises", "<b>Live game</b> and the final quiz", "<b>Your kit</b>: every prompt, examples for your work, and a 7-day plan"]),
        cta: [app, "Open the workshop app"], after: p("See you in the room!") });
      break;
    case "slides":
      Object.assign(c, { title: "Your slides, prompts and 7-day plan", pre: "Everything from yesterday, in one place. Day 1 of your challenge starts today.",
        body: p(`Hi ${n}, thank you for coming to the free workshop yesterday. As promised, everything is in your workshop app:`)
          + list(["<b>Slides</b>: every slide from the session", "<b>Kit</b>: all prompts, 8 tricks to try at home, examples for your work", "<b>7-day challenge</b>: 10 minutes a day. Day 1: brief one real email with Who · Why · What · How · Don’t"]),
        cta: [app, "Open your slides and kit"],
        after: (rated ? "" : p("One small favour: if you haven’t rated the workshop yet, it takes 30 seconds in the Kit tab and shapes the next one."))
          + p('Want more? I run new hands-on workshops in Dahab, and private ones for teams. <a href="' + h(wa) + '" style="color:#17322A">Message me on WhatsApp</a> to get a seat at the next one.') });
      break;
    case "call":
      Object.assign(c, { title: "Let's look at your AI plan together", pre: "Your free 20-minute call: pick a time that suits you.",
        body: p(`Hi ${n}, you asked for a free 20-minute call, so let’s book it.`) + p("Bring the upgrade plan you made in the workshop (Kit → Part 4). I’ll tell you honestly which step is worth doing first, and what it would take."),
        cta: [wa, "Pick a time on WhatsApp"], after: p("Or simply reply to this email with two times that work for you.") });
      break;
    case "day3":
      Object.assign(c, { title: "Day 3: how's your AI week going?", pre: "Today’s 10-minute challenge, and an offer if you’re stuck.",
        body: p(`Hi ${n}, quick check-in on your 7-day challenge.`) + p("<b>Today:</b> research one topic your clients care about, with web search turned on, and open the sources.")
          + p("Stuck on a task? Reply with what you tried, and I’ll send you a better brief."),
        cta: [app, "Open your kit"] });
      break;
    case "course":
      Object.assign(c, { title: "AI Launchpad: the 4-week course", pre: "Live, small group, founding price for the first 15 seats.",
        body: p(`Hi ${n}, you asked about the course, so here it is.`) + list(["<b>4 weeks, live, in a small group</b>", "From your first good prompt to your own AI assistant for your work or business", "<b>Founding price $199</b> for the first 15 seats (then $349)"]),
        cta: [wa, "Ask for the dates on WhatsApp"], after: p("Have a question first? Just reply to this email.") });
      break;
    default:
      Object.assign(c, { title: "Day 7: count your saved minutes", pre: "The last day of your challenge, and what comes next.",
        body: p(`Hi ${n}, it’s the last day of the challenge. Add up the minutes AI saved you this week, and tell someone.`)
          + p("If it’s more than an hour, imagine a system doing those tasks without anyone typing. That’s step 4 of the ladder, and it’s what I build."),
        cta: [wa, "Book a free 20-minute call"], after: p("Thank you for being part of the first one.") });
  }
  const subjects = { welcome: "You're in, " + (r.name || "there") + "! Your workshop app", slides: "Your slides, prompts and 7-day plan", call: "Let's look at your AI plan together",
    day3: "Day 3: how's your AI week going?", course: "AI Launchpad: the 4-week course", day7: "Day 7: count your saved minutes" };
  return { subject: subjects[type] ?? c.title, html: layout(env, c), text: text(env, c) };
}

// ---------------------------------------------------------------------------------------------------------
// HTTP

const isAdmin = (env, key) => !!key && !!env.ADMIN_KEY && safeEqual(key, env.ADMIN_KEY);
const body = async (request) => { try { const d = await request.json(); return d && typeof d === "object" ? d : {}; } catch { return {}; } };

export async function api(request, env, db, url) {
  const action = url.searchParams.get("action") ?? "";
  const method = request.method;
  const key = url.searchParams.get("key") ?? "";
  const admin = isAdmin(env, key);
  const people = () => db.load("checkins");

  if (action === "checkin" && method === "POST") {
    const input = await body(request);
    if (!Object.keys(input).length) return json({ ok: false, error: "Something went wrong. Try again." }, 400);
    if (input.website) return json({ ok: true }); // spam trap
    const t = Math.floor(now());
    const ipKey = await db.ipKey(request);
    let blocked = false;
    db.edit("rate", (r) => {
      for (const k of Object.keys(r)) { r[k] = r[k].filter((x) => x > t - 3600); if (!r[k].length) delete r[k]; }
      if ((r[ipKey]?.length ?? 0) >= 30) { blocked = true; return r; }
      (r[ipKey] ??= []).push(t);
      return r;
    });
    if (blocked) return json({ ok: false, error: "Too many tries from this network. Wait a few minutes." }, 429);

    let id = pidOf(input.id);
    if (id.length < 8 || id.length > 40) id = randHex(8);
    const name = cut(input.name, 60);
    if (!name) return json({ ok: false, error: "Please add your name." }, 400);
    const email = cut(input.email, 120);
    let phone = String(input.phone ?? "").replace(/[^0-9+]/g, "");
    phone = phone.startsWith("+") ? "+" + phone.replace(/\D/g, "") : phone.replace(/\D/g, "");
    const pd = phone.replace(/\D/g, "").length;
    if (phone && (pd < 8 || pd > 15)) return json({ ok: false, error: "That WhatsApp number doesn’t look complete. Include the country code." }, 400);
    if (email && !validEmail(email)) return json({ ok: false, error: "That email doesn’t look right. Check it or leave it empty." }, 400);
    const w = input.wants ?? {};
    const wantsObj = { handout: !!w.handout, course: !!w.course, call: !!w.call, updates: !!w.updates };
    if (!email && !phone && (wantsObj.handout || wantsObj.course || wantsObj.call || wantsObj.updates)) return json({ ok: false, error: "Add your WhatsApp or email so I can send you what you ticked." }, 400);
    const level = LEVELS.includes(input.level) ? input.level : "some";
    const hours = HOURS[input.hours] !== undefined ? input.hours : "";
    let country = String(input.country ?? "").toUpperCase();
    if (!/^([A-Z]{2}|XX)$/.test(country)) country = "";
    const rec = { id, name, work: cut(input.work, 120), level, hours, country, task: cut(input.task, 240), question: cut(input.question, 280), email, phone, wants: wantsObj, at: isoNow() };
    let saved = null;
    db.edit("checkins", (d) => {
      const old = d[id] ?? {};
      rec.answered = old.answered ?? false;
      rec.hidden = old.hidden ?? false;
      rec.first = old.first ?? rec.at;
      if (old.quiz !== undefined) rec.quiz = old.quiz;
      if (old.fb !== undefined) rec.fb = old.fb;
      if (old.unsub && old.email === rec.email) rec.unsub = true;
      d[id] = rec; saved = rec;
      return d;
    });
    // Queue their emails and send the welcome right away. A mail problem never blocks check-in.
    try { enqueue(env, db, saved); await processMail(env, db, 3, saved.id); } catch (e) { console.error("workshop mail:", e?.message ?? e); }
    return json({ ok: true, id });
  }

  if (action === "wall") {
    const d = people();
    const qs = [];
    const levels = { new: 0, some: 0, daily: 0 };
    let hoursTotal = 0, hoursN = 0;
    const countries = {};
    for (const r of Object.values(d)) {
      if (levels[r.level] !== undefined) levels[r.level]++;
      if (HOURS[r.hours] !== undefined) { hoursTotal += HOURS[r.hours]; hoursN++; }
      const cc = r.country ?? "";
      if (cc && cc !== "XX") countries[cc] = (countries[cc] ?? 0) + 1;
      if (!r.question) continue;
      if (r.hidden && !admin) continue;
      qs.push({ id: r.id, q: r.question, answered: !!r.answered, hidden: !!r.hidden, at: r.first ?? r.at });
    }
    qs.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    const st = db.load("state");
    return json({ ok: true, count: Object.keys(d).length, levels, questions: qs, admin, hours: hoursTotal, hoursN, countries, step: Number(st.step ?? 0) });
  }

  if (action === "state") return json({ ok: true, step: Number(db.load("state").step ?? 0) });

  if (action === "step" && method === "POST") {
    if (!admin) return json({ ok: false, error: "Not allowed." }, 403);
    const input = await body(request);
    const step = Math.max(0, Math.min(6, Math.trunc(Number(input.step ?? 0)) || 0));
    db.edit("state", (s) => { s.step = step; s.at = isoNow(); return s; });
    return json({ ok: true, step });
  }

  if (action === "mark" && method === "POST") {
    if (!admin) return json({ ok: false, error: "Not allowed." }, 403);
    const input = await body(request);
    const id = String(input.id ?? "").replace(/[^a-z0-9]/g, "");
    const field = ["answered", "hidden"].includes(input.field) ? input.field : null;
    if (!id || !field) return json({ ok: false, error: "Bad request." }, 400);
    db.edit("checkins", (d) => { if (d[id]) d[id][field] = !d[id][field]; return d; });
    return json({ ok: true });
  }

  if (action === "export") {
    if (!admin) return json({ ok: false, error: "Not allowed." }, 403);
    const pts = gamePoints(db.load("game"));
    const rows = [["Name", "Country", "WhatsApp", "Work", "AI level", "Hours a week", "Weekly task", "Question", "Email", "Handout", "Course", "Free call", "Updates OK", "Quiz /5", "Game points", "Rating /5", "Most useful (testimonial)", "OK to publish", "Improve", "Checked in"]];
    for (const r of Object.values(people())) {
      rows.push([r.name, r.country ?? "", r.phone ? "https://wa.me/" + r.phone.replace(/\D/g, "") : "", r.work, r.level, r.hours ?? "", r.task, r.question, r.email,
        r.wants?.handout ? "yes" : "", r.wants?.course ? "yes" : "", r.wants?.call ? "yes" : "", r.wants?.updates ? "yes" : "", r.quiz ?? "", pts[r.id] ?? 0,
        r.fb?.rating ?? "", r.fb?.quote ?? "", r.fb?.publish ? "yes" : "", r.fb?.improve ?? "", r.first ?? r.at]);
    }
    return csv(rows, "workshop-checkins.csv");
  }

  if (action === "live") {
    const st = db.load("state");
    let g = db.load("game");
    const pid = pidOf(url.searchParams.get("id"));
    const ppl = people();
    const player = pid && ppl[pid] && !admin ? pid : ""; // the host watches, never plays
    if (g.phase === "open") {
      const t = now();
      const tryG = structuredClone(g);
      const a = gameTick(tryG, player, t), c = gameTickAll(tryG, t), b = gameAutodone(tryG, t);
      if (a || b || c) g = db.edit("game", (x) => { const t2 = now(); gameTick(x, player, t2); gameTickAll(x, t2); gameAutodone(x, t2); return x; });
    }
    return json({ ok: true, step: Number(st.step ?? 0), open: !!st.open, known: !!(pid && ppl[pid]), game: gameView(g, player, ppl), now: now() });
  }

  if (action === "answer" && method === "POST") {
    const input = await body(request);
    const pid = pidOf(input.id);
    const q = Math.trunc(Number(input.q ?? -1)), c = Math.trunc(Number(input.c ?? -1));
    const ppl = people();
    if (!pid || !ppl[pid]) return json({ ok: false, error: "Check in first to play." }, 400);
    let res = { ok: false, error: "Time’s up for this one." };
    const g = db.edit("game", (g) => {
      const t = now();
      if (g.phase !== "open") { res.error = "The game is not running."; return g; }
      gameTick(g, pid, t);
      const pr = g.prog[pid];
      if (pr.q > q && g.answers?.[q]?.[pid] && Number(g.answers[q][pid].c) >= 0) { res.error = "You already answered."; return g; }
      if (pr.q !== q || !QS[q] || c < 0 || c >= QS[q].o.length || t < pr.at) return g;
      if (g.answers?.[q]?.[pid]) { res.error = "You already answered."; return g; }
      (g.answers[q] ??= {})[pid] = { c, t: round(Math.min(t - pr.at, qlim(q)), 2) };
      g.prog[pid] = { q: q + 1, at: t + PAUSE };
      res = { ok: true };
      return g;
    });
    return json({ ...res, game: gameView(g, pid, ppl) }, res.ok ? 200 : 400);
  }

  if (action === "gamectl" && method === "POST") {
    if (!admin) return json({ ok: false, error: "Not allowed." }, 403);
    const op = String((await body(request)).op ?? "");
    db.edit("game", (g) => {
      // 3-second countdown so every phone shows question 1 at the same moment.
      if (op === "start") return { phase: "open", startedAt: now() + 3, answers: {}, prog: {} };
      if (op === "end" && g.phase === "open") { g.phase = "done"; g.endedAt = now(); }
      else if (op === "close") g.phase = "idle";
      return g;
    });
    return json({ ok: true });
  }

  if (action === "feedback" && method === "POST") {
    const input = await body(request);
    const pid = pidOf(input.id);
    const rating = Math.trunc(Number(input.rating ?? 0));
    if (rating < 1 || rating > 5) return json({ ok: false, error: "Pick a rating from 1 to 5." }, 400);
    const fb = { rating, quote: cut(input.quote, 400), improve: cut(input.improve, 400), publish: !!input.publish, at: isoNow() };
    let found = false;
    db.edit("checkins", (d) => { if (d[pid]) { d[pid].fb = fb; found = true; } return d; });
    return found ? json({ ok: true }) : json({ ok: false, error: "Check in first (Today tab), then send your feedback." }, 400);
  }

  if (action === "quiz" && method === "POST") {
    const input = await body(request);
    const pid = pidOf(input.id);
    const score = Math.max(0, Math.min(5, Math.trunc(Number(input.score ?? 0)) || 0));
    let found = false;
    db.edit("checkins", (d) => { if (d[pid]) { d[pid].quiz = score; found = true; } return d; });
    return json({ ok: found });
  }

  return json({ ok: false, error: "Not found." }, 404);
}

export async function unsub(env, db, url) {
  const pid = pidOf(url.searchParams.get("u"));
  const ok = !!pid && !!env.ADMIN_KEY && safeEqual(await hmacHex(env.ADMIN_KEY, "unsub:" + pid), url.searchParams.get("t") ?? "");
  if (ok) db.edit("checkins", (d) => { if (d[pid]) d[pid].unsub = true; return d; });
  const wa = waLink(env);
  return html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Brief Your AI · Emails</title>
<style>body{margin:0;background:#F4EFE3;color:#1E2430;font:17px/1.5 system-ui,-apple-system,Arial,sans-serif;display:grid;place-items:center;min-height:100vh;padding:24px 16px;box-sizing:border-box}
.c{max-width:440px;background:#FBF8F1;border:1.5px solid #DCD2BD;border-radius:16px;padding:26px}h1{font:600 26px Georgia,serif;margin:0 0 10px}a{color:#17322A}</style></head>
<body><div class="c">${ok
    ? `<h1>You’re unsubscribed</h1><p>You won’t get any more workshop emails. Your workshop app still works at <a href="${h(env.SITE_URL)}">${h(env.SITE_URL.replace(/^https?:\/\//, ""))}</a>.</p><p>Changed your mind? Message Ahmed on <a href="${h(wa)}">WhatsApp</a>.</p>`
    : `<h1>Link not recognised</h1><p>This unsubscribe link looks incomplete. Message Ahmed on <a href="${h(wa)}">WhatsApp</a> and he’ll remove you.</p>`}</div></body></html>`);
}

export async function cron(env, db, url) {
  if (!isAdmin(env, url.searchParams.get("key") ?? "")) return new Response("Not allowed.\n", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const r = await processMail(env, db, 60);
  return new Response(`${isoNow()} sent ${r.sent}, skipped ${r.skipped}, failed ${r.failed}${r.waiting ? " (waiting: add the BREVO_API_KEY secret)" : ""}\nacademy reminders sent 0\n`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

const flag = (cc) => (/^[A-Z]{2}$/.test(cc) && cc !== "XX" ? String.fromCodePoint(127397 + cc.charCodeAt(0), 127397 + cc.charCodeAt(1)) : "");

export async function admin(request, env, db, url) {
  const key = url.searchParams.get("key") ?? "";
  if (!isAdmin(env, key)) return new Response("Not allowed.", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  const preview = url.searchParams.get("preview");
  if (preview && TYPES[preview]) {
    const m = await render(env, preview, { id: "preview0000", name: "Sara", email: "sara@example.com", wants: {} });
    return html("<!-- Subject: " + h(m.subject) + " -->" + m.html.replace('<body style="margin:0;padding:0;background:#F4EFE3">', '<body style="margin:0;padding:0;background:#F4EFE3"><p style="font:14px Arial;text-align:center;margin:12px">Subject: <b>' + h(m.subject) + "</b></p>"));
  }
  let notice = "";
  if (request.method === "POST") {
    const f = await request.formData();
    const doWhat = String(f.get("do") ?? "");
    if (String(f.get("confirm") ?? "") === "RESET") {
      for (const n of ["checkins", "game", "state", "rate", "mailq"]) db.reset(n);
      notice = "All data cleared. You are ready for a fresh session.";
    } else if (doWhat === "open") {
      const st = db.edit("state", (s) => { s.open = !s.open; return s; });
      notice = st.open ? "Everything is open: every phone now sees all slides, the full Kit and the quiz." : "Back to normal: parts unlock as you move through the workshop.";
    } else if (doWhat === "sendnow") {
      const res = await processMail(env, db, 60);
      notice = res.waiting ? "Brevo key not set yet: emails are waiting in the queue." : `Sent ${res.sent}, skipped ${res.skipped}, failed ${res.failed}.`;
    } else if (doWhat === "toggle" && TYPES[String(f.get("type") ?? "")]) {
      const t = String(f.get("type"));
      const cfgNow = mailCfg(db);
      db.edit("mailcfg", (c) => { c[t] = !cfgNow[t]; return c; });
      notice = TYPES[t].label + (mailCfg(db)[t] ? " is on." : " is off.");
    } else {
      notice = "Nothing was cleared. Type RESET exactly to confirm.";
    }
  }
  const d = Object.values(db.load("checkins")).sort((a, b) => String(a.first ?? a.at).localeCompare(String(b.first ?? b.at)));
  const k = h(encodeURIComponent(key));
  const levels = { new: "Never or rarely", some: "Sometimes", daily: "Every day" };
  const rated = d.filter((r) => r.fb);
  const avg = rated.length ? Math.round((rated.reduce((s, r) => s + r.fb.rating, 0) / rated.length) * 10) / 10 : 0;
  const follow = d.filter((r) => r.wants?.course || r.wants?.call || r.wants?.handout || r.wants?.updates).length;
  const isOpen = !!db.load("state").open;
  const rows = d.map((r) => {
    const ph = r.phone ?? "";
    const tags = (r.wants?.handout ? '<span class="tag">Handout</span>' : "") + (r.wants?.course ? '<span class="tag">Course</span>' : "") + (r.wants?.call ? '<span class="tag">Free call</span>' : "") + (r.wants?.updates ? '<span class="tag">Updates</span>' : "");
    const fb = r.fb ? `<b>${"★".repeat(Number(r.fb.rating))}</b>${r.fb.quote ? "<br>“" + h(r.fb.quote) + "”" : ""}${r.fb.publish ? ' <span class="tag">OK to publish</span>' : ""}${r.fb.improve ? "<br><small>Improve: " + h(r.fb.improve) + "</small>" : ""}` : "";
    return `<tr><td>${h(r.name)}</td><td>${h(flag(r.country ?? ""))} ${h((r.country ?? "") === "XX" ? "" : r.country ?? "")}</td><td>${h(r.work)}</td><td>${h(levels[r.level] ?? r.level)}</td><td>${h(r.hours ?? "")}</td><td>${h(r.task)}</td><td>${h(r.question)}</td>
  <td>${ph ? `<a href="https://wa.me/${h(ph.replace(/\D/g, ""))}" target="_blank" rel="noopener">${h(ph)}</a>` : ""}</td><td>${h(r.email)}</td><td>${tags}</td><td>${r.quiz !== undefined ? h(r.quiz) + "/5" : ""}</td><td>${fb}</td></tr>`;
  }).join("");

  const q = db.load("mailq"); const cfg = mailCfg(db); const stat = {};
  let lastErr = "";
  for (const it of Object.values(q)) if (it.note && it.status !== "skipped") lastErr = it.note;
  for (const it of Object.values(q)) {
    const s = (stat[it.type] ??= {});
    s[it.status] = (s[it.status] ?? 0) + 1;
    if (it.status === "queued") s.next = Math.min(s.next ?? Infinity, it.due);
  }
  const fmt = (ts) => new Date(ts * 1000).toLocaleString("en-GB", { timeZone: "Africa/Cairo", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).replace(",", "");
  const whoLabel = { handout: "slides and prompts", call: "free call", course: "course" };
  const mailRows = Object.entries(TYPES).map(([tk, t]) => {
    const s = stat[tk] ?? {};
    return `<tr><td><b>${h(t.label)}</b><br><a href="admin.php?key=${k}&amp;preview=${h(tk)}" target="_blank">Preview</a></td>
  <td>${t.who === "" ? "Everyone with an email" : "Ticked “" + h(whoLabel[t.who]) + "”"}</td><td>${s.queued ?? 0}</td><td>${s.sent ?? 0}</td><td>${s.failed ?? 0}</td>
  <td>${s.next !== undefined ? fmt(s.next) : ""}</td>
  <td><form method="post" action="admin.php?key=${k}" style="margin:0"><input type="hidden" name="do" value="toggle"><input type="hidden" name="type" value="${h(tk)}"><button style="font:700 13px system-ui;border:1.5px solid var(--line);background:${cfg[tk] ? "var(--green);color:var(--paper)" : "var(--card);color:var(--ink)"};border-radius:999px;padding:6px 12px;cursor:pointer">${cfg[tk] ? "On" : "Off"}</button></form></td></tr>`;
  }).join("");

  return html(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Brief Your AI · Attendees</title>
<style>
:root{--paper:#F4EFE3;--card:#FBF8F1;--line:#DCD2BD;--ink:#1E2430;--soft:#5A6070;--green:#17322A;--gold:#D9B86A;color-scheme:light}
body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.45 system-ui,-apple-system,Arial,sans-serif;padding:24px max(16px,env(safe-area-inset-right,0px)) 48px max(16px,env(safe-area-inset-left,0px))}
h1{font:600 30px Georgia,serif;margin:0 0 6px}
.meta{color:var(--soft);margin:0 0 18px}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:18px}
.actions a{background:var(--green);color:var(--paper);text-decoration:none;font-weight:700;padding:10px 16px;border-radius:999px}
.actions a.alt{background:var(--card);color:var(--ink);border:1.5px solid var(--line)}
.scroll{overflow-x:auto;background:var(--card);border:1.5px solid var(--line);border-radius:12px}
table{border-collapse:collapse;width:100%;min-width:900px}
th,td{text-align:left;vertical-align:top;padding:10px 12px;border-bottom:1px solid var(--line)}
th{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--soft);background:#EFE8D8}
.reset{margin-top:28px;background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:16px;display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.reset input{font:15px system-ui;padding:9px 12px;border:1.5px solid var(--line);border-radius:8px}
.reset button{font:700 14px system-ui;background:#A8261C;color:#fff;border:0;border-radius:999px;padding:10px 16px;cursor:pointer}
.opentoggle{margin:0 0 16px;background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:14px 16px;display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.opentoggle span{flex:1;min-width:200px}
.opentoggle button{font:700 14px system-ui;background:var(--green);color:var(--paper);border:0;border-radius:999px;padding:10px 16px;cursor:pointer}
.notice{background:#E3F0E7;color:#2E6B4A;font-weight:700;padding:10px 14px;border-radius:10px;margin:0 0 16px}
.tag{display:inline-block;background:var(--gold);color:var(--green);font-weight:700;font-size:12px;border-radius:999px;padding:2px 8px;margin:0 4px 4px 0}
</style></head><body>
<h1>Attendees</h1>
${notice ? `<p class="notice">${h(notice)}</p>` : ""}
<p class="meta">${d.length} checked in · ${follow} asked for a follow-up · ${rated.length} rated${rated.length ? " (average " + avg + "/5)" : ""} · refresh to update</p>
<form method="post" action="admin.php?key=${k}" class="opentoggle">
  <b>${isOpen ? "Everything is open for everyone" : "Parts unlock as you go"}</b>
  <span style="color:var(--soft)">${isOpen ? "Every phone sees all slides, the full Kit and the quiz. Good for practice and after the workshop." : "Normal workshop mode. Turn on to let everyone see everything (practice, or after the event)."}</span>
  <input type="hidden" name="do" value="open"><button type="submit">${isOpen ? "Back to normal" : "Open everything"}</button>
</form>
<div class="actions">
  <a href="api.php?action=export&amp;key=${k}">Download CSV</a>
  <a class="alt" href="wall.html?key=${k}">Open the wall with host controls</a>
</div>
<div class="scroll"><table>
<tr><th>Name</th><th>From</th><th>Work</th><th>AI level</th><th>Hours/week</th><th>Weekly task</th><th>Question</th><th>WhatsApp</th><th>Email</th><th>Wants</th><th>Quiz</th><th>Feedback</th></tr>
${rows || '<tr><td colspan="12">No check-ins yet.</td></tr>'}
</table></div>
<h2 style="font:600 24px Georgia,serif;margin:30px 0 6px">Emails</h2>
<p class="meta">${!env.BREVO_API_KEY ? "⚠️ Brevo key not set: emails wait in the queue until you add the BREVO_API_KEY secret." : "✓ Sending through Brevo as " + h(env.MAIL_FROM_NAME) + " &lt;" + h(env.MAIL_FROM) + "&gt;."} Follow-ups go out every 15 minutes.</p>
${lastErr ? `<p class="meta" style="color:#A8261C"><b>Last sending error:</b> ${h(lastErr)} (it retries every 15 minutes, up to 3 times)</p>` : ""}
<div class="scroll"><table style="min-width:700px">
<tr><th>Email</th><th>Goes to</th><th>Queued</th><th>Sent</th><th>Failed</th><th>Next</th><th></th></tr>
${mailRows}
</table></div>
<form method="post" action="admin.php?key=${k}" style="margin-top:12px"><input type="hidden" name="do" value="sendnow"><button style="font:700 14px system-ui;background:var(--green);color:var(--paper);border:0;border-radius:999px;padding:10px 16px;cursor:pointer">Send due emails now</button></form>
<form class="reset" method="post" action="admin.php?key=${k}">
  <b>Start fresh</b><span style="color:var(--soft)">Deletes all check-ins, game scores, progress and queued emails. Download the CSV first if you need it.</span>
  <input name="confirm" placeholder="Type RESET" autocomplete="off" aria-label="Type RESET to confirm">
  <button type="submit">Clear all data</button>
</form>
</body></html>`);
}
