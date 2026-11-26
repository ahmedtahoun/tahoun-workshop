// Tahoun AI Academy server (port of academy/api.php, admin.php, verify.php, unsub.php).
// The free course is retired: join/progress/final answer 410, and there are no course reminders.
import { h, p, layout, text, send, hmacHex, safeEqual, csv, json, html, cut, validEmail, now, isoNow, waLink } from "./mail.js";

const TYPES = { workshop: "Next workshop", launchpad: "AI Launchpad waitlist", freelance: "AI for freelancers", business: "AI for business owners", corporate: "Team / corporate training" };
const ADMIN_TYPES = { launchpad: "AI Launchpad", freelance: "Freelancers", business: "Business owner", corporate: "Team / corporate" };

const aid = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const aphone = (s) => { let v = String(s ?? "").replace(/[^0-9+]/g, ""); return v.startsWith("+") ? "+" + v.replace(/\D/g, "") : v.replace(/\D/g, ""); };
const token = (env, id) => hmacHex(env.ADMIN_KEY, "academy:" + id);
const isAdmin = (env, key) => !!key && !!env.ADMIN_KEY && safeEqual(key, env.ADMIN_KEY);
const unsubUrl = async (env, id) => env.ACADEMY_URL + "unsub.php?u=" + id + "&t=" + (await token(env, id));
const randHex = (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

async function mail(env, to, name, subject, c) {
  if (!env.BREVO_API_KEY || !to) return false;
  c = { label: "Academy", why: "You get this because you signed up at Tahoun AI Academy.", unsub: "", ...c };
  try { return (await send(env, to, name, subject, layout(env, c), text(env, c))).ok; } catch { return false; }
}

// 40 calls per network per hour.
async function rateBlocked(db, request, limit = 40) {
  const t = Math.floor(now());
  const ip = await db.ipKey(request);
  let blocked = false;
  db.edit("arate", (r) => {
    for (const k of Object.keys(r)) { r[k] = r[k].filter((x) => x > t - 3600); if (!r[k].length) delete r[k]; }
    if ((r[ip]?.length ?? 0) >= limit) { blocked = true; return r; }
    (r[ip] ??= []).push(t);
    return r;
  });
  return blocked;
}

async function pub(env, r) {
  return { id: r.id, name: r.name, done: r.done ?? {}, cert: r.cert ?? null, token: await token(env, r.id) };
}

export async function api(request, env, db, url) {
  const action = url.searchParams.get("action") ?? "";
  let input = {};
  if (request.method === "POST") { try { const d = await request.json(); if (d && typeof d === "object") input = d; } catch { /* empty */ } }

  if (["join", "progress", "final"].includes(action)) return json({ ok: false, error: "The free course has closed. Join the next workshop instead." }, 410);

  if (action === "me") { // resume on another device with the emailed link
    const id = aid(url.searchParams.get("u"));
    const t = url.searchParams.get("t") ?? "";
    const d = db.load("learners");
    if (!id || !d[id] || !safeEqual(await token(env, id), t)) return json({ ok: false, error: "This link isn’t valid any more. Start again below; it takes 20 seconds." }, 404);
    return json({ ok: true, ...(await pub(env, d[id])) });
  }

  if (action === "lead" && request.method === "POST") {
    if (input.website) return json({ ok: true });
    if (await rateBlocked(db, request)) return json({ ok: false, error: "Too many tries from this network. Wait a few minutes." }, 429);
    const type = String(input.type ?? "");
    if (!TYPES[type]) return json({ ok: false, error: "Pick what you’re interested in." }, 400);
    const name = cut(input.name, 60);
    if (!name) return json({ ok: false, error: "Please add your name." }, 400);
    const email = cut(input.email, 120);
    if (email && !validEmail(email)) return json({ ok: false, error: "That email doesn’t look right." }, 400);
    const phone = aphone(input.phone); const pd = phone.replace(/\D/g, "").length;
    if (phone && (pd < 8 || pd > 15)) return json({ ok: false, error: "That WhatsApp number doesn’t look complete. Include the country code." }, 400);
    if (!email && !phone) return json({ ok: false, error: "Add your email or WhatsApp so I can reply." }, 400);
    const lead = { id: randHex(6), type, name, email, phone, company: cut(input.company, 100), team: cut(input.team, 20), goal: cut(input.goal, 600), at: isoNow() };
    db.edit("aleads", (l) => { l.push(lead); return l; });
    const wa = waLink(env);
    // Tell Ahmed straight away.
    await mail(env, env.MAIL_FROM, env.MAIL_FROM_NAME, "New Academy enquiry: " + TYPES[type] + " from " + name, {
      label: "New lead", title: TYPES[type], pre: name + (lead.company ? " · " + lead.company : ""),
      body: p("<b>" + h(name) + "</b>" + (lead.company ? " · " + h(lead.company) : "") + (lead.team ? " · team of " + h(lead.team) : ""))
        + p((email ? "Email: " + h(email) + "<br>" : "") + (phone ? "WhatsApp: " + h(phone) : "")) + (lead.goal ? p("“" + h(lead.goal).replace(/\n/g, "<br>\n") + "”") : ""),
      cta: phone ? ["https://wa.me/" + phone.replace(/\D/g, ""), "Reply on WhatsApp"] : ["mailto:" + email, "Reply by email"], why: "Sent to you by your Academy site.",
    });
    // And reply to the person instantly.
    if (email) {
      const next = {
        workshop: ["You’re on the list for the next workshop", "I’ll send you the date and place of the next Brief Your AI workshop as soon as it’s set. Seats are limited, so you’ll hear before I post it anywhere.", "Message me on WhatsApp"],
        launchpad: ["You’re on the AI Launchpad waitlist", "Founding seats are limited to 15 at $199 (then $349). I’ll send you the dates before anyone else.", "Message me on WhatsApp"],
        freelance: ["You’re on the list for AI for freelancers", "I’ll tell you as soon as the freelancer track opens: outreach, scoping, pricing and delivering AI projects.", "Message me on WhatsApp"],
        business: ["Let’s book your free 20-minute call", "Tell me two times that suit you, and bring the one task that takes the most time in your business. I’ll tell you honestly what AI can do for it.", "Pick a time on WhatsApp"],
        corporate: ["Thanks for asking about team training", "I’ll reply personally with a short proposal: the format, the topics for your team and the price. If it’s easier to talk first, message me on WhatsApp.", "Message me on WhatsApp"],
      }[type];
      await mail(env, email, name, next[0], { title: next[0], pre: "Thanks " + name + ", here’s what happens next.",
        body: p("Hi " + h(name) + ", thank you for getting in touch.") + p(next[1]), cta: [wa, next[2]],
        after: p("I reply personally, usually the same day."), why: "You get this because you sent an enquiry at Tahoun AI Academy." });
    }
    return json({ ok: true });
  }

  if (action === "export") {
    if (!isAdmin(env, url.searchParams.get("key") ?? "")) return json({ ok: false, error: "Not allowed." }, 403);
    if (url.searchParams.get("what") === "leads") {
      const rows = [["Interest", "Name", "Company", "Team size", "Email", "WhatsApp", "Goal", "Date"]];
      for (const l of db.load("aleads")) rows.push([TYPES[l.type] ?? l.type, l.name, l.company, l.team, l.email, l.phone ? "https://wa.me/" + l.phone.replace(/\D/g, "") : "", l.goal, l.at]);
      return csv(rows, "academy-leads.csv");
    }
    const rows = [["Name", "Email", "WhatsApp", "Lessons done", "Certificate", "Score", "From", "Joined"]];
    for (const r of Object.values(db.load("learners"))) rows.push([r.name, r.email, r.phone ? "https://wa.me/" + r.phone.replace(/\D/g, "") : "", Object.keys(r.done ?? {}).length + "/5", r.cert?.id ?? "", r.cert ? r.cert.score + "/5" : "", r.source ?? "", r.joined]);
    return csv(rows, "academy-learners.csv");
  }

  return json({ ok: false, error: "Not found." }, 404);
}

export async function unsub(env, db, url) {
  const id = aid(url.searchParams.get("u"));
  const ok = !!id && !!env.ADMIN_KEY && safeEqual(await token(env, id), url.searchParams.get("t") ?? "");
  if (ok) db.edit("learners", (d) => { if (d[id]) d[id].unsub = true; return d; });
  return html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Emails · Tahoun AI Academy</title><link rel="stylesheet" href="academy.css"></head>
<body><main class="wrap narrow" style="padding-block:80px"><h1 style="font-size:40px">${ok ? "You’re unsubscribed" : "Link not recognised"}</h1>
<p class="lead" style="margin-top:12px">${ok ? "You won’t get more Academy emails. Your course and certificate still work." : "Message Ahmed on WhatsApp and he’ll remove you."}</p>
<p style="margin-top:20px"><a class="btn alt" href="${h(waLink(env))}">WhatsApp</a></p></main></body></html>`);
}

export async function verify(env, db, url) {
  const c = String(url.searchParams.get("c") ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  let cert = null;
  if (c) {
    const pid = db.load("certs")[c];
    const r = pid ? db.load("learners")[pid] : null;
    if (r && r.cert?.id === c) cert = r.cert;
  }
  const date = cert ? new Date(cert.date + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "";
  const res = html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${cert ? "Certificate · " + h(cert.name) : "Certificate check"} · Tahoun AI Academy</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 100 100%27%3E%3Crect width=%27100%27 height=%27100%27 rx=%2720%27 fill=%27%2317322A%27/%3E%3Ctext x=%2750%27 y=%2768%27 font-size=%2752%27 text-anchor=%27middle%27 fill=%27%23D9B86A%27 font-family=%27Georgia%27%3EAI%3C/text%3E%3C/svg%3E">
${cert ? `<meta property="og:title" content="${h(cert.name)} completed Brief Your AI"><meta property="og:description" content="Certificate ${h(c)} · Tahoun AI Academy">` : ""}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:wght@500;600&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="academy.css">
<script src="social.js" defer></script>
<style>.vc{max-width:720px;margin:0 auto;padding-block:clamp(40px,8vw,90px)}.cert{background:var(--green);color:var(--paper);border-radius:22px;padding:clamp(30px,6vw,56px) 26px;text-align:center;border:3px solid var(--gold);box-shadow:inset 0 0 0 7px var(--green),inset 0 0 0 8px rgba(217,184,106,.6)}.cert .k{font-size:12px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--gold)}.cert .n{font-family:var(--display);font-size:clamp(40px,8vw,64px);margin:16px 0 8px}.cert .s{color:#C9D6CC;font-size:18px}.cert .meta{margin-top:22px;font-size:14px;color:#C9D6CC}.ok{display:inline-block;margin-top:18px;background:#E3F0E7;color:var(--ok);font-weight:700;border-radius:999px;padding:6px 14px;font-size:14px}</style>
</head><body>
<header class="top"><div class="wrap"><a class="mark" href="./">Tahoun <span>AI</span> Academy</a><nav><a class="btn" href="./">Tahoun AI Academy</a></nav></div></header>
<main class="wrap"><div class="vc">
${cert ? `<div class="cert"><p class="k">Certificate of completion</p><p class="n">${h(cert.name)}</p><p class="s">completed <b>Brief Your AI</b>, a practical AI course from Tahoun AI Academy, with ${Number(cert.score)}/5 on the final quiz.</p>
  <p class="meta">${h(date)} · Certificate ${h(c)} · Instructor: Ahmed Tahoun</p><p class="meta" style="margin-top:6px">This is not an official or accredited certification.</p></div>
  <p style="text-align:center"><span class="ok">✓ Verified: issued by Tahoun AI Academy</span></p>
  <p class="soft" style="text-align:center;margin-top:18px">The course covers how AI answers questions, the five-line brief, AI as a thinking partner, the upgrade ladder for a business, and safe use.</p>`
    : `<h1>Certificate not found</h1><p class="lead" style="margin-top:14px">Check the code and try again.</p>
  <p style="margin-top:22px"><a class="btn" href="./">Go to the Academy</a></p>`}
</div></main>
<footer><div class="wrap"><span>Tahoun AI Academy · Ahmed Tahoun</span><div class="socrow" data-social aria-label="Social links"></div></div></footer>
</body></html>`);
  res.headers.delete("X-Robots-Tag"); // certificate pages are public and may be indexed
  return res;
}

export async function admin(env, db, url) {
  const key = url.searchParams.get("key") ?? "";
  if (!isAdmin(env, key)) return new Response("Not allowed.", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  const k = h(encodeURIComponent(key));
  const L = Object.values(db.load("learners")).sort((a, b) => String(b.joined).localeCompare(String(a.joined)));
  const Q = [...db.load("aleads")].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const certs = L.filter((r) => r.cert).length;
  const byType = {}; for (const l of Q) byType[l.type] = (byType[l.type] ?? 0) + 1;
  const wa = (ph) => (!ph ? "" : `<a href="https://wa.me/${h(ph.replace(/\D/g, ""))}" target="_blank" rel="noopener">${h(ph)}</a>`);
  return html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Academy admin</title>
<link rel="stylesheet" href="academy.css">
<style>body{font-size:15px}.box{overflow-x:auto;background:var(--card);border:1.5px solid var(--line);border-radius:12px;margin:10px 0 30px}table{border-collapse:collapse;width:100%;min-width:820px}th,td{text-align:left;vertical-align:top;padding:9px 11px;border-bottom:1px solid var(--line)}th{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--soft);background:#EFE8D8}.tag{display:inline-block;background:var(--gold);color:var(--green);font-weight:700;font-size:12px;border-radius:999px;padding:2px 8px}.kpis{display:flex;flex-wrap:wrap;gap:12px;margin:14px 0 24px}.kpis div{background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:12px 16px}.kpis b{display:block;font-family:var(--display);font-size:30px;color:var(--red)}</style></head>
<body><main class="wrap" style="padding-block:30px 60px">
<h1 style="font-size:40px">Academy</h1>
<div class="kpis"><div><b>${L.length}</b>learners</div><div><b>${certs}</b>certificates</div>${Object.entries(ADMIN_TYPES).map(([t, label]) => `<div><b>${byType[t] ?? 0}</b>${h(label)}</div>`).join("")}</div>
<div class="row"><a class="btn" href="api.php?action=export&amp;what=leads&amp;key=${k}">Download enquiries (CSV)</a><a class="btn alt" href="api.php?action=export&amp;what=learners&amp;key=${k}">Download learners (CSV)</a><a class="btn alt" href="../workshop/admin.php?key=${k}">Workshop admin</a></div>
<h2 style="font-size:28px;margin-top:30px">Enquiries</h2>
<div class="box"><table><tr><th>Interest</th><th>Name</th><th>Company / team</th><th>WhatsApp</th><th>Email</th><th>Goal</th><th>Date</th></tr>
${Q.map((l) => `<tr><td><span class="tag">${h(ADMIN_TYPES[l.type] ?? l.type)}</span></td><td>${h(l.name)}</td><td>${h(l.company)}${l.team ? " · " + h(l.team) : ""}</td><td>${wa(l.phone)}</td><td>${h(l.email)}</td><td>${h(l.goal)}</td><td>${h(String(l.at).slice(0, 10))}</td></tr>`).join("") || '<tr><td colspan="7">No enquiries yet.</td></tr>'}</table></div>
<h2 style="font-size:28px">Learners</h2>
<div class="box"><table><tr><th>Name</th><th>WhatsApp</th><th>Email</th><th>Lessons</th><th>Certificate</th><th>From</th><th>Joined</th></tr>
${L.map((r) => `<tr><td>${h(r.name)}</td><td>${wa(r.phone ?? "")}</td><td>${h(r.email)}</td><td>${Object.keys(r.done ?? {}).length}/5</td><td>${r.cert ? `<a href="verify.php?c=${h(r.cert.id)}" target="_blank">${h(r.cert.id)}</a> (${Number(r.cert.score)}/5)` : ""}</td><td>${h(r.source ?? "")}</td><td>${h(String(r.joined).slice(0, 10))}</td></tr>`).join("") || '<tr><td colspan="7">No learners yet.</td></tr>'}</table></div>
</main></body></html>`);
}
