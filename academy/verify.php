<?php
// Public certificate page: tahoun.wheretospot.com/academy/verify.php?c=ABCD2345
require __DIR__ . '/lib.php';
$c = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string)($_GET['c'] ?? '')));
$cert = null;
if ($c !== '') { $pid = a_load('certs.json')[$c] ?? null; $r = $pid ? (a_load('learners.json')[$pid] ?? null) : null; if ($r && ($r['cert']['id'] ?? '') === $c) $cert = $r['cert']; }
$date = $cert ? date('j F Y', strtotime($cert['date'])) : '';
?><!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title><?= $cert ? 'Certificate · ' . m_h($cert['name']) : 'Certificate check' ?> · Tahoun AI Academy</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 100 100%27%3E%3Crect width=%27100%27 height=%27100%27 rx=%2720%27 fill=%27%2317322A%27/%3E%3Ctext x=%2750%27 y=%2768%27 font-size=%2752%27 text-anchor=%27middle%27 fill=%27%23D9B86A%27 font-family=%27Georgia%27%3EAI%3C/text%3E%3C/svg%3E">
<?php if ($cert): ?><meta property="og:title" content="<?= m_h($cert['name']) ?> completed Brief Your AI"><meta property="og:description" content="Certificate <?= m_h($c) ?> · Tahoun AI Academy"><?php endif; ?>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:wght@500;600&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="academy.css">
<script src="social.js" defer></script>
<style>.vc{max-width:720px;margin:0 auto;padding-block:clamp(40px,8vw,90px)}.cert{background:var(--green);color:var(--paper);border-radius:22px;padding:clamp(30px,6vw,56px) 26px;text-align:center;border:3px solid var(--gold);box-shadow:inset 0 0 0 7px var(--green),inset 0 0 0 8px rgba(217,184,106,.6)}.cert .k{font-size:12px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--gold)}.cert .n{font-family:var(--display);font-size:clamp(40px,8vw,64px);margin:16px 0 8px}.cert .s{color:#C9D6CC;font-size:18px}.cert .meta{margin-top:22px;font-size:14px;color:#C9D6CC}.ok{display:inline-block;margin-top:18px;background:#E3F0E7;color:var(--ok);font-weight:700;border-radius:999px;padding:6px 14px;font-size:14px}</style>
</head><body>
<header class="top"><div class="wrap"><a class="mark" href="./">Tahoun <span>AI</span> Academy</a><nav><a class="btn" href="course.html">Take the free course</a></nav></div></header>
<main class="wrap"><div class="vc">
<?php if ($cert): ?>
  <div class="cert"><p class="k">Certificate of completion</p><p class="n"><?= m_h($cert['name']) ?></p><p class="s">completed <b>Brief Your AI</b>, the free practical AI course from Tahoun AI Academy, with <?= (int)$cert['score'] ?>/5 on the final quiz.</p>
  <p class="meta"><?= m_h($date) ?> · Certificate <?= m_h($c) ?> · Instructor: Ahmed Tahoun</p><p class="meta" style="margin-top:6px">This is not an official or accredited certification.</p></div>
  <p style="text-align:center"><span class="ok">✓ Verified: issued by Tahoun AI Academy for completing the free course</span></p>
  <p class="soft" style="text-align:center;margin-top:18px">The course covers how AI answers questions, the five-line brief, AI as a thinking partner, the upgrade ladder for a business, and safe use.</p>
<?php else: ?>
  <h1>Certificate not found</h1><p class="lead" style="margin-top:14px">Check the code and try again, or take the free course to earn your own.</p>
  <p style="margin-top:22px"><a class="btn" href="course.html">Take the free course</a></p>
<?php endif; ?>
</div></main>
<footer><div class="wrap"><span>Tahoun AI Academy · Ahmed Tahoun</span><div class="socrow" data-social aria-label="Social links"></div></div></footer>
</body></html>
