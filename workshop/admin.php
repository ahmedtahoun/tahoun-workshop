<?php
ini_set('display_errors', '0');
require __DIR__ . '/config.php';
require_once __DIR__ . '/mail.php';
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');
$key = (string)($_GET['key'] ?? '');
if ($key === '' || !hash_equals(ADMIN_KEY, $key)) { http_response_code(403); echo 'Not allowed.'; exit; }
$dir = getenv('WS_DATA_DIR') ?: __DIR__ . '/data';
$file = $dir . '/checkins.json';
// Preview an email exactly as people receive it: admin.php?key=…&preview=welcome
if (isset($_GET['preview']) && isset(m_types()[$_GET['preview']])) {
    $sample = ['id' => 'preview0000', 'name' => 'Sara', 'email' => 'sara@example.com', 'wants' => []];
    $m = m_render($_GET['preview'], $sample);
    echo '<!-- Subject: ' . m_h($m['subject']) . ' -->' . str_replace('<body style="margin:0;padding:0;background:#F4EFE3">', '<body style="margin:0;padding:0;background:#F4EFE3"><p style="font:14px Arial;text-align:center;margin:12px">Subject: <b>' . m_h($m['subject']) . '</b></p>', $m['html']);
    exit;
}
$notice = '';
// Reset: clears check-ins, game, progress and rate limits. Use it once before the workshop to remove test data.
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['confirm'] ?? '') === 'RESET') {
    foreach (['checkins.json', 'game.json', 'state.json', 'rate.json', 'mailq.json'] as $f) { if (is_file("$dir/$f")) unlink("$dir/$f"); }
    $notice = 'All data cleared. You are ready for a fresh session.';
} elseif (($_POST['do'] ?? '') === 'open') {
    $sf = $dir . '/state.json';
    $st = is_file($sf) ? (json_decode((string)file_get_contents($sf), true) ?: []) : [];
    $st['open'] = empty($st['open']);
    file_put_contents($sf, json_encode($st), LOCK_EX);
    $notice = $st['open'] ? 'Everything is open: every phone now sees all slides, the full Kit and the quiz.' : 'Back to normal: parts unlock as you move through the workshop.';
} elseif (($_POST['do'] ?? '') === 'sendnow') {
    $res = m_process(60);
    $notice = $res['waiting'] ? 'Brevo key not set yet: emails are waiting in the queue.' : "Sent {$res['sent']}, skipped {$res['skipped']}, failed {$res['failed']}.";
} elseif (($_POST['do'] ?? '') === 'toggle' && isset(m_types()[$_POST['type'] ?? ''])) {
    $t = $_POST['type'];
    m_edit('mailcfg.json', function ($c) use ($t) { $c[$t] = !(m_cfg()[$t]); return $c; });
    $notice = m_types()[$t]['label'] . (m_cfg()[$t] ? ' is on.' : ' is off.');
} elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $notice = 'Nothing was cleared. Type RESET exactly to confirm.';
}
$d = is_file($file) ? (json_decode((string)file_get_contents($file), true) ?: []) : [];
uasort($d, function ($a, $b) { return strcmp($a['first'] ?? $a['at'], $b['first'] ?? $b['at']); });
function flag($cc) { if (!preg_match('/^[A-Z]{2}$/', $cc) || $cc === 'XX') return ''; return html_entity_decode('&#' . (127397 + ord($cc[0])) . ';&#' . (127397 + ord($cc[1])) . ';', ENT_HTML5, 'UTF-8'); }
function e($s) { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }
$k = e(urlencode($key));
$levels = ['new' => 'Never or rarely', 'some' => 'Sometimes', 'daily' => 'Every day'];
$rated = array_filter($d, function ($r) { return !empty($r['fb']); });
$avg = $rated ? round(array_sum(array_map(function ($r) { return $r['fb']['rating']; }, $rated)) / count($rated), 1) : 0;
$follow = 0; foreach ($d as $r) { if ($r['wants']['course'] || $r['wants']['call'] || $r['wants']['handout'] || !empty($r['wants']['updates'])) $follow++; }
?><!doctype html>
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
<?php if ($notice): ?><p class="notice"><?= e($notice) ?></p><?php endif; ?>
<p class="meta"><?= count($d) ?> checked in · <?= $follow ?> asked for a follow-up · <?= count($rated) ?> rated<?= $rated ? ' (average ' . $avg . '/5)' : '' ?> · refresh to update</p>
<?php $stNow = is_file($dir . '/state.json') ? (json_decode((string)file_get_contents($dir . '/state.json'), true) ?: []) : []; $isOpen = !empty($stNow['open']); ?>
<form method="post" action="admin.php?key=<?= $k ?>" class="opentoggle">
  <b><?= $isOpen ? 'Everything is open for everyone' : 'Parts unlock as you go' ?></b>
  <span style="color:var(--soft)"><?= $isOpen ? 'Every phone sees all slides, the full Kit and the quiz. Good for practice and after the workshop.' : 'Normal workshop mode. Turn on to let everyone see everything (practice, or after the event).' ?></span>
  <input type="hidden" name="do" value="open"><button type="submit"><?= $isOpen ? 'Back to normal' : 'Open everything' ?></button>
</form>
<div class="actions">
  <a href="api.php?action=export&amp;key=<?= $k ?>">Download CSV</a>
  <a class="alt" href="wall.html?key=<?= $k ?>">Open the wall with host controls</a>
</div>
<div class="scroll"><table>
<tr><th>Name</th><th>From</th><th>Work</th><th>AI level</th><th>Hours/week</th><th>Weekly task</th><th>Question</th><th>WhatsApp</th><th>Email</th><th>Wants</th><th>Quiz</th><th>Feedback</th></tr>
<?php foreach ($d as $r): ?>
<tr>
  <td><?= e($r['name']) ?></td>
  <td><?= e(flag($r['country'] ?? '')) ?> <?= e(($r['country'] ?? '') === 'XX' ? '' : ($r['country'] ?? '')) ?></td>
  <td><?= e($r['work']) ?></td>
  <td><?= e($levels[$r['level']] ?? $r['level']) ?></td>
  <td><?= e($r['hours'] ?? '') ?></td>
  <td><?= e($r['task']) ?></td>
  <td><?= e($r['question']) ?></td>
  <td><?php $ph = $r['phone'] ?? ''; if ($ph !== ''): ?><a href="https://wa.me/<?= e(preg_replace('/\D/', '', $ph)) ?>" target="_blank" rel="noopener"><?= e($ph) ?></a><?php endif; ?></td>
  <td><?= e($r['email']) ?></td>
  <td><?php if ($r['wants']['handout']) echo '<span class="tag">Handout</span>'; if ($r['wants']['course']) echo '<span class="tag">Course</span>'; if ($r['wants']['call']) echo '<span class="tag">Free call</span>'; if (!empty($r['wants']['updates'])) echo '<span class="tag">Updates</span>'; ?></td>
  <td><?= isset($r['quiz']) ? e($r['quiz']) . '/5' : '' ?></td>
  <td><?php if (!empty($r['fb'])): ?><b><?= str_repeat('★', (int)$r['fb']['rating']) ?></b><?php if ($r['fb']['quote'] !== ''): ?><br>“<?= e($r['fb']['quote']) ?>”<?php endif; ?><?php if (!empty($r['fb']['publish'])): ?> <span class="tag">OK to publish</span><?php endif; ?><?php if ($r['fb']['improve'] !== ''): ?><br><small>Improve: <?= e($r['fb']['improve']) ?></small><?php endif; ?><?php endif; ?></td>
</tr>
<?php endforeach; if (!$d): ?><tr><td colspan="12">No check-ins yet.</td></tr><?php endif; ?>
</table></div>
<?php
$q = m_load('mailq.json'); $cfg = m_cfg(); $stat = [];
$lastErr = ''; foreach ($q as $it) { if (!empty($it['note']) && $it['status'] !== 'skipped') $lastErr = $it['note']; } foreach ($q as $it) { $stat[$it['type']][$it['status']] = ($stat[$it['type']][$it['status']] ?? 0) + 1; if ($it['status'] === 'queued') { $stat[$it['type']]['next'] = min($stat[$it['type']]['next'] ?? PHP_INT_MAX, $it['due']); } }
$tz = new DateTimeZone('Africa/Cairo');
?>
<h2 style="font:600 24px Georgia,serif;margin:30px 0 6px">Emails</h2>
<p class="meta"><?= BREVO_API_KEY === '' ? '⚠️ Brevo key not set: emails wait in the queue until you add it in config.php.' : '✓ Sending through Brevo as ' . m_h(MAIL_FROM_NAME) . ' &lt;' . m_h(MAIL_FROM) . '&gt;.' ?> Follow-ups go out every 15 minutes from the cron job.</p>
<?php if ($lastErr !== ''): ?><p class="meta" style="color:#A8261C"><b>Last sending error:</b> <?= m_h($lastErr) ?> (it retries every 15 minutes, up to 3 times)</p><?php endif; ?>
<div class="scroll"><table style="min-width:700px">
<tr><th>Email</th><th>Goes to</th><th>Queued</th><th>Sent</th><th>Failed</th><th>Next</th><th></th></tr>
<?php foreach (m_types() as $tk => $t): $s = $stat[$tk] ?? []; ?>
<tr>
  <td><b><?= m_h($t['label']) ?></b><br><a href="admin.php?key=<?= $k ?>&amp;preview=<?= m_h($tk) ?>" target="_blank">Preview</a></td>
  <td><?= $t['who'] === '' ? 'Everyone with an email' : 'Ticked “' . m_h(['handout' => 'slides and prompts', 'call' => 'free call', 'course' => 'course'][$t['who']]) . '”' ?></td>
  <td><?= $s['queued'] ?? 0 ?></td><td><?= $s['sent'] ?? 0 ?></td><td><?= $s['failed'] ?? 0 ?></td>
  <td><?= isset($s['next']) ? (new DateTime('@' . $s['next']))->setTimezone($tz)->format('D j M, H:i') : '' ?></td>
  <td><form method="post" action="admin.php?key=<?= $k ?>" style="margin:0"><input type="hidden" name="do" value="toggle"><input type="hidden" name="type" value="<?= m_h($tk) ?>"><button style="font:700 13px system-ui;border:1.5px solid var(--line);background:<?= $cfg[$tk] ? 'var(--green);color:var(--paper)' : 'var(--card);color:var(--ink)' ?>;border-radius:999px;padding:6px 12px;cursor:pointer"><?= $cfg[$tk] ? 'On' : 'Off' ?></button></form></td>
</tr>
<?php endforeach; ?>
</table></div>
<form method="post" action="admin.php?key=<?= $k ?>" style="margin-top:12px"><input type="hidden" name="do" value="sendnow"><button style="font:700 14px system-ui;background:var(--green);color:var(--paper);border:0;border-radius:999px;padding:10px 16px;cursor:pointer">Send due emails now</button></form>
<form class="reset" method="post" action="admin.php?key=<?= $k ?>">
  <b>Start fresh</b><span style="color:var(--soft)">Deletes all check-ins, game scores, progress and queued emails. Download the CSV first if you need it.</span>
  <input name="confirm" placeholder="Type RESET" autocomplete="off" aria-label="Type RESET to confirm">
  <button type="submit">Clear all data</button>
</form>
</body></html>
