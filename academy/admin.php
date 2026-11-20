<?php
// Academy admin: learners, certificates and enquiries. Same key as the workshop admin.
require __DIR__ . '/lib.php';
header('Cache-Control: no-store'); header('X-Robots-Tag: noindex, nofollow');
if (!a_admin()) { http_response_code(403); echo 'Not allowed.'; exit; }
$k = m_h(urlencode((string)$_GET['key']));
$L = a_load('learners.json'); $Q = a_load('leads.json');
uasort($L, function ($a, $b) { return strcmp($b['joined'], $a['joined']); });
usort($Q, function ($a, $b) { return strcmp($b['at'], $a['at']); });
$TYPES = ['launchpad' => 'AI Launchpad', 'freelance' => 'Freelancers', 'business' => 'Business owner', 'corporate' => 'Team / corporate'];
$certs = count(array_filter($L, function ($r) { return !empty($r['cert']); }));
$byType = []; foreach ($Q as $l) $byType[$l['type']] = ($byType[$l['type']] ?? 0) + 1;
$wa = function ($p) { return $p === '' ? '' : '<a href="https://wa.me/' . m_h(preg_replace('/\D/', '', $p)) . '" target="_blank" rel="noopener">' . m_h($p) . '</a>'; };
?><!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Academy admin</title>
<link rel="stylesheet" href="academy.css">
<style>body{font-size:15px}.box{overflow-x:auto;background:var(--card);border:1.5px solid var(--line);border-radius:12px;margin:10px 0 30px}table{border-collapse:collapse;width:100%;min-width:820px}th,td{text-align:left;vertical-align:top;padding:9px 11px;border-bottom:1px solid var(--line)}th{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--soft);background:#EFE8D8}.tag{display:inline-block;background:var(--gold);color:var(--green);font-weight:700;font-size:12px;border-radius:999px;padding:2px 8px}.kpis{display:flex;flex-wrap:wrap;gap:12px;margin:14px 0 24px}.kpis div{background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:12px 16px}.kpis b{display:block;font-family:var(--display);font-size:30px;color:var(--red)}</style></head>
<body><main class="wrap" style="padding-block:30px 60px">
<h1 style="font-size:40px">Academy</h1>
<div class="kpis"><div><b><?= count($L) ?></b>learners</div><div><b><?= $certs ?></b>certificates</div><?php foreach ($TYPES as $t => $label): ?><div><b><?= $byType[$t] ?? 0 ?></b><?= m_h($label) ?></div><?php endforeach; ?></div>
<div class="row"><a class="btn" href="api.php?action=export&amp;what=leads&amp;key=<?= $k ?>">Download enquiries (CSV)</a><a class="btn alt" href="api.php?action=export&amp;what=learners&amp;key=<?= $k ?>">Download learners (CSV)</a><a class="btn alt" href="../workshop/admin.php?key=<?= $k ?>">Workshop admin</a></div>
<h2 style="font-size:28px;margin-top:30px">Enquiries</h2>
<div class="box"><table><tr><th>Interest</th><th>Name</th><th>Company / team</th><th>WhatsApp</th><th>Email</th><th>Goal</th><th>Date</th></tr>
<?php foreach ($Q as $l): ?><tr><td><span class="tag"><?= m_h($TYPES[$l['type']] ?? $l['type']) ?></span></td><td><?= m_h($l['name']) ?></td><td><?= m_h($l['company']) ?><?= $l['team'] !== '' ? ' · ' . m_h($l['team']) : '' ?></td><td><?= $wa($l['phone']) ?></td><td><?= m_h($l['email']) ?></td><td><?= m_h($l['goal']) ?></td><td><?= m_h(substr($l['at'], 0, 10)) ?></td></tr><?php endforeach; ?>
<?php if (!$Q): ?><tr><td colspan="7">No enquiries yet.</td></tr><?php endif; ?></table></div>
<h2 style="font-size:28px">Learners</h2>
<div class="box"><table><tr><th>Name</th><th>WhatsApp</th><th>Email</th><th>Lessons</th><th>Certificate</th><th>From</th><th>Joined</th></tr>
<?php foreach ($L as $r): ?><tr><td><?= m_h($r['name']) ?></td><td><?= $wa($r['phone'] ?? '') ?></td><td><?= m_h($r['email']) ?></td><td><?= count($r['done'] ?? []) ?>/5</td><td><?php if (!empty($r['cert'])): ?><a href="verify.php?c=<?= m_h($r['cert']['id']) ?>" target="_blank"><?= m_h($r['cert']['id']) ?></a> (<?= (int)$r['cert']['score'] ?>/5)<?php endif; ?></td><td><?= m_h($r['source'] ?? '') ?></td><td><?= m_h(substr($r['joined'], 0, 10)) ?></td></tr><?php endforeach; ?>
<?php if (!$L): ?><tr><td colspan="7">No learners yet.</td></tr><?php endif; ?></table></div>
</main></body></html>
