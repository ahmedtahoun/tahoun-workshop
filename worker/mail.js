// Email design and sending, shared by the workshop and the Academy (port of workshop/mail.php).
// One table-based layout for every email: it renders the same in Gmail, Outlook and Apple Mail.

export const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);

export const waLink = (env) => "https://wa.me/" + String(env.CONTACT_WHATSAPP || "").replace(/\D/g, "");

export function p(s) { return '<p style="margin:0 0 14px">' + s + "</p>"; }

export function list(items) {
  let o = '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 14px;width:100%">';
  for (const it of items) o += '<tr><td width="26" valign="top" style="color:#2E6B4A;font-weight:bold;padding:3px 0">&#10003;</td><td style="padding:3px 0">' + it + "</td></tr>";
  return o + "</table>";
}

// c = { pre, label, title, body, cta: [url, label], after, why, unsub }
export function layout(env, c) {
  const font = "font-family:Arial,Helvetica,sans-serif";
  let btn = "";
  if (c.cta) {
    btn = '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 8px"><tr><td bgcolor="#17322A" style="border-radius:999px">'
      + '<a href="' + h(c.cta[0]) + '" style="display:inline-block;padding:15px 28px;' + font + ';font-size:16px;font-weight:bold;color:#F4EFE3;text-decoration:none;border-radius:999px">' + h(c.cta[1]) + " &rarr;</a></td></tr></table>";
  }
  const link = (href, label) => '<a href="' + h(href) + '" style="color:#17322A;text-decoration:underline">' + h(label) + "</a>";
  const sig = '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;border-top:1px solid #E6DECB;padding-top:20px;width:100%"><tr>'
    + '<td width="52" valign="top" style="padding-top:20px"><div style="width:44px;height:44px;border-radius:50%;background:#17322A;color:#D9B86A;font:bold 16px Georgia,serif;line-height:44px;text-align:center">AT</div></td>'
    + '<td valign="top" style="padding:20px 0 0 12px;' + font + ';font-size:14px;line-height:1.5;color:#5A6070"><b style="color:#1E2430;font-size:15px">Ahmed Tahoun</b><br>AI consultant &amp; trainer · Tahoun AI Academy<br>'
    + link(waLink(env), "WhatsApp") + " &nbsp;·&nbsp; " + link(env.CONTACT_LINKEDIN, "LinkedIn") + " &nbsp;·&nbsp; " + link(env.CONTACT_WEBSITE, "Website") + "</td></tr></table>";
  const foot = h(c.why ?? "") + (c.unsub ? '<br><a href="' + h(c.unsub) + '" style="color:#8A8474;text-decoration:underline">Unsubscribe</a>' : "");
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>' + h(c.title) + "</title></head>"
    + '<body style="margin:0;padding:0;background:#F4EFE3">'
    + '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#F4EFE3">' + h(c.pre ?? "") + "&#8203;&nbsp;".repeat(30) + "</div>"
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F4EFE3"><tr><td align="center" style="padding:24px 12px">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:580px">'
    + '<tr><td bgcolor="#17322A" style="border-radius:16px 16px 0 0;padding:20px 28px"><span style="font:600 22px Georgia,serif;color:#F4EFE3">Tahoun <span style="color:#D9B86A">AI</span></span>'
    + '<span style="float:right;' + font + ';font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#D9B86A;line-height:30px">' + h(c.label ?? "") + "</span></td></tr>"
    + '<tr><td bgcolor="#FFFDF8" style="border:1px solid #E6DECB;border-top:0;border-radius:0 0 16px 16px;padding:30px 28px 28px;' + font + ';font-size:16px;line-height:1.6;color:#1E2430">'
    + '<h1 style="margin:0 0 16px;font:600 27px/1.2 Georgia,serif;color:#1E2430">' + h(c.title) + "</h1>"
    + c.body + btn + (c.after ?? "") + sig
    + "</td></tr>"
    + '<tr><td style="padding:18px 8px;' + font + ';font-size:12px;line-height:1.6;color:#8A8474;text-align:center">' + foot + "</td></tr>"
    + "</table></td></tr></table></body></html>";
}

const decode = (s) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&rarr;/g, "→").replace(/&#10003;/g, "✓");

// Plain-text version for clients that don't show HTML.
export function text(env, c) {
  let body = (c.body + (c.after ?? "")).replace(/<a href="([^"]+)"[^>]*>([^<]*)<\/a>/g, "$2 ($1)");
  body = body.replace(/<br>/g, "\n").replace(/<\/p>/g, "\n\n").replace(/<\/tr>/g, "\n");
  let t = decode(body.replace(/<[^>]+>/g, "")).trim().replace(/[ \t]+/g, " ");
  return c.title + "\n\n" + t + (c.cta ? "\n\n" + c.cta[1] + ": " + c.cta[0] : "")
    + "\n\nAhmed Tahoun\nAI consultant & trainer · Tahoun AI Academy\nWhatsApp: " + waLink(env) + "\nLinkedIn: " + env.CONTACT_LINKEDIN
    + (c.unsub ? "\n\nUnsubscribe: " + c.unsub : "");
}

export async function send(env, to, name, subject, html, textBody, tag = "workshop") {
  if (!env.BREVO_API_KEY) return { ok: false, error: "Brevo key not set" };
  try {
    const r = await fetch(env.BREVO_URL || "https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "api-key": env.BREVO_API_KEY },
      body: JSON.stringify({
        sender: { name: env.MAIL_FROM_NAME, email: env.MAIL_FROM },
        replyTo: { email: env.MAIL_FROM, name: env.MAIL_FROM_NAME },
        to: [{ email: to, name }],
        subject, htmlContent: html, textContent: textBody, tags: [tag],
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (r.ok) return { ok: true };
    return { ok: false, error: "Brevo said " + r.status + ": " + (await r.text()).slice(0, 200) };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

// HMAC-SHA256 hex, first n characters (same as PHP substr(hash_hmac(...), 0, n)).
export async function hmacHex(secret, msg, n = 20) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, n);
}

export async function sha256Hex(s) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// CSV with a BOM (so Excel shows accents and Arabic) and spreadsheet-formula protection.
export function csv(rows, filename) {
  const cell = (v) => {
    let s = String(v ?? "");
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return /[",\n\r\t ]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return new Response("﻿" + rows.map((r) => r.map(cell).join(",")).join("\n") + "\n", {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
  });
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

export function html(body, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
}

// Trim, strip control characters, cut to n characters.
export const cut = (s, n) => [...String(s ?? "").replace(/[\x00-\x1F\x7F]+/g, " ").trim()].slice(0, n).join("");
export const validEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
export const now = () => Date.now() / 1000;
export const isoNow = () => new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
