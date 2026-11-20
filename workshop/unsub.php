<?php
// One-click unsubscribe from workshop emails. Linked at the bottom of every email.
require_once __DIR__ . '/mail.php';
header('X-Robots-Tag: noindex, nofollow');
$pid = preg_replace('/[^a-z0-9]/', '', strtolower((string)($_GET['u'] ?? '')));
$ok = $pid !== '' && hash_equals(m_token($pid), (string)($_GET['t'] ?? ''));
if ($ok) m_edit('checkins.json', function ($d) use ($pid) { if (isset($d[$pid])) $d[$pid]['unsub'] = true; return $d; });
?><!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Brief Your AI · Emails</title>
<style>body{margin:0;background:#F4EFE3;color:#1E2430;font:17px/1.5 system-ui,-apple-system,Arial,sans-serif;display:grid;place-items:center;min-height:100vh;padding:24px 16px;box-sizing:border-box}
.c{max-width:440px;background:#FBF8F1;border:1.5px solid #DCD2BD;border-radius:16px;padding:26px}h1{font:600 26px Georgia,serif;margin:0 0 10px}a{color:#17322A}</style></head>
<body><div class="c"><?php if ($ok): ?><h1>You’re unsubscribed</h1><p>You won’t get any more workshop emails. Your workshop app still works at <a href="<?= m_h(SITE_URL) ?>"><?= m_h(preg_replace('#^https?://#', '', SITE_URL)) ?></a>.</p><p>Changed your mind? Message Ahmed on <a href="<?= m_h(m_wa()) ?>">WhatsApp</a>.</p>
<?php else: ?><h1>Link not recognised</h1><p>This unsubscribe link looks incomplete. Message Ahmed on <a href="<?= m_h(m_wa()) ?>">WhatsApp</a> and he’ll remove you.</p><?php endif; ?></div></body></html>
