// Builds dist/ for Cloudflare: the homepage at the root, plus the static files of /workshop/ and /academy/.
// PHP files and data/ folders are left out: the Worker in worker/ answers those URLs now.
import { cpSync, rmSync, mkdirSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
cpSync("home", "dist", { recursive: true });
const keep = (src) => !/\.php$/.test(src) && !/\/data(\/|$)/.test(src) && !src.endsWith(".DS_Store");
for (const dir of ["workshop", "academy"]) cpSync(dir, `dist/${dir}`, { recursive: true, filter: keep });
console.log("dist/ ready");
