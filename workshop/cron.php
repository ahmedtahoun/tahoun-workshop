<?php
// Sends due workshop emails. Run every 15 minutes from cPanel → Cron Jobs:
//   php /home/<your-cpanel-user>/<tahoun folder>/workshop/cron.php
// It can also be opened in a browser with ?key=YOUR_ADMIN_KEY to send due emails right away.
require_once __DIR__ . '/mail.php';
if (PHP_SAPI !== 'cli') {
    header('Content-Type: text/plain; charset=utf-8');
    if (!hash_equals(ADMIN_KEY, (string)($_GET['key'] ?? ''))) { http_response_code(403); exit("Not allowed.\n"); }
}
$r = m_process(60);
echo date('c') . ' sent ' . $r['sent'] . ', skipped ' . $r['skipped'] . ', failed ' . $r['failed'] . ($r['waiting'] ? ' (waiting: add BREVO_API_KEY in config.php)' : '') . "\n";
// Academy course reminders (if the Academy is installed next to the workshop).
if (is_file(__DIR__ . '/../academy/nudge.php')) { require_once __DIR__ . '/../academy/nudge.php'; echo 'academy reminders sent ' . a_nudges() . "\n"; }
