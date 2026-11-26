// tahoun.wheretospot.com on Cloudflare.
// Static files (homepage, /workshop/, /academy/) come from dist/ (built by scripts/build.mjs).
// The old PHP URLs are answered here, unchanged, so the pages' scripts didn't change:
//   /api/agent-token.php  /api/lead.php  /api/leads.csv
//   /workshop/api.php  /workshop/admin.php  /workshop/unsub.php  /workshop/cron.php
//   /academy/api.php   /academy/admin.php   /academy/verify.php  /academy/unsub.php
// All data (check-ins, game, emails queue, learners, leads) lives in one Durable Object ("Store"),
// which runs one request at a time: the same guarantee the PHP file locks gave.
import { DurableObject } from "cloudflare:workers";
import * as workshop from "./workshop.js";
import * as academy from "./academy.js";
import * as home from "./home.js";
import { sha256Hex } from "./mail.js";

const LISTS = ["aleads", "homeleads"]; // documents that are arrays; every other document is an object
const DOCS = ["checkins", "game", "state", "rate", "mailq", "mailcfg", "learners", "certs", "aleads", "arate", "homeleads", "hrate"];
const empty = (name) => (LISTS.includes(name) ? [] : {});

export class Store extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.docs = {};
    ctx.blockConcurrencyWhile(async () => {
      const got = await ctx.storage.get(DOCS);
      for (const n of DOCS) this.docs[n] = got.get(n) ?? empty(n);
    });
  }

  // A copy of a document (callers may change it freely).
  load(name) { return structuredClone(this.docs[name] ?? empty(name)); }

  // Read, change and save a document in one step. Synchronous, so nothing can run in between.
  edit(name, fn) {
    const d = fn(this.load(name)) ?? empty(name);
    this.docs[name] = d;
    this.ctx.storage.put(name, d);
    return structuredClone(d);
  }

  reset(name) { this.docs[name] = empty(name); this.ctx.storage.delete(name); }

  // A per-network key for rate limits (the IP is never stored in plain text).
  async ipKey(request) { return sha256Hex(request.headers.get("CF-Connecting-IP") ?? ""); }

  async fetch(request) {
    const url = new URL(request.url);
    const env = this.env;
    const path = url.pathname;
    try {
      switch (path) {
        case "/api/agent-token.php": return await home.agentToken(request, env, this, url);
        case "/api/lead.php": return await home.lead(request, env, this);
        case "/api/leads.csv": return home.leadsCsv(env, this, url);
        case "/workshop/api.php": return await workshop.api(request, env, this, url);
        case "/workshop/admin.php": return await workshop.admin(request, env, this, url);
        case "/workshop/unsub.php": return await workshop.unsub(env, this, url);
        case "/workshop/cron.php": return await workshop.cron(env, this, url);
        case "/academy/api.php": return await academy.api(request, env, this, url);
        case "/academy/admin.php": return await academy.admin(env, this, url);
        case "/academy/verify.php": return await academy.verify(env, this, url);
        case "/academy/unsub.php": return await academy.unsub(env, this, url);
        case "/__scheduled": {
          const r = await workshop.processMail(env, this, 60);
          return Response.json(r);
        }
        case "/__import": return this.importData(request, env);
      }
      return new Response("Not found", { status: 404 });
    } catch (e) {
      console.error("tahoun store:", path, e?.stack ?? e);
      return Response.json({ ok: false, error: "Server error. Tell Ahmed." }, { status: 500 });
    }
  }

  // One-time move of the cPanel data files. Body: { docName: value, ... }.
  async importData(request, env) {
    const key = new URL(request.url).searchParams.get("key") ?? "";
    // IMPORT_KEY is a temporary secret, set only for the move and deleted afterwards.
    if (!env.IMPORT_KEY || key !== env.IMPORT_KEY || request.method !== "POST") return new Response("Not allowed.", { status: 403 });
    const data = await request.json();
    const done = [];
    for (const [n, v] of Object.entries(data)) {
      if (!DOCS.includes(n)) continue;
      this.edit(n, () => v);
      done.push(`${n}: ${Array.isArray(v) ? v.length : Object.keys(v).length}`);
    }
    return Response.json({ ok: true, imported: done });
  }
}

const DYNAMIC = new Set([
  "/api/agent-token.php", "/api/lead.php", "/api/leads.csv",
  "/workshop/api.php", "/workshop/admin.php", "/workshop/unsub.php", "/workshop/cron.php",
  "/academy/api.php", "/academy/admin.php", "/academy/verify.php", "/academy/unsub.php",
  "/__import",
]);

const store = (env) => env.STORE.get(env.STORE.idFromName("main"));

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (DYNAMIC.has(url.pathname)) return store(env).fetch(request);
    // Server-only files that used to sit next to the pages: never served.
    if (/\.php$/.test(url.pathname) || /^\/(workshop|academy)\/data(\/|$)/.test(url.pathname)) return new Response("Not found", { status: 404 });
    // Addresses stay exactly as on cPanel: /x.html is served as is, a folder serves its index.html.
    if (url.pathname.endsWith("/")) {
      const idx = new URL(url.pathname + "index.html", url);
      const res = await env.ASSETS.fetch(new Request(idx, request));
      if (res.status !== 404) return new Response(res.body, res);
    } else if (!/\.[a-z0-9]+$/i.test(url.pathname)) {
      const probe = await env.ASSETS.fetch(new Request(new URL(url.pathname + "/index.html", url), request));
      if (probe.status !== 404) return Response.redirect(new URL(url.pathname + "/" + url.search, url).toString(), 301);
    }
    return env.ASSETS.fetch(request);
  },

  // Every 15 minutes: send the workshop emails that are due (replaces the cPanel cron job that never existed).
  async scheduled(event, env, ctx) {
    ctx.waitUntil(store(env).fetch("https://store/__scheduled").then((r) => r.text()).then((t) => console.log("mail run:", t)));
  },
};
