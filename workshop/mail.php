<?php
// Workshop email engine: a queue in data/mailq.json, timed follow-ups, Brevo sending, unsubscribe links.
// Used by api.php (check-in), cron.php (every 15 minutes) and admin.php (status, preview, send now).
require_once __DIR__ . '/config.php';

function m_dir() { return getenv('WS_DATA_DIR') ?: __DIR__ . '/data'; }
function m_load($f) { $p = m_dir() . "/$f"; if (!is_file($p)) return []; $d = json_decode((string)file_get_contents($p), true); return is_array($d) ? $d : []; }
function m_edit($f, callable $fn) {
    $h = fopen(m_dir() . "/$f", 'c+');
    if (!$h) return null;
    flock($h, LOCK_EX);
    $d = json_decode((string)stream_get_contents($h), true);
    $d = $fn(is_array($d) ? $d : []);
    ftruncate($h, 0); rewind($h);
    fwrite($h, json_encode($d, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    fflush($h); flock($h, LOCK_UN); fclose($h);
    return $d;
}
function m_now() { $t = getenv('WS_NOW'); return $t ? strtotime($t) : time(); } // WS_NOW lets local tests travel in time
function m_h($s) { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }

// ---- The sequence ----
// who: which tick box a person needs ('' = everyone with an email). at: [days after the event, "HH:MM" Cairo time], or 'now'.
function m_types() {
    return [
        'welcome' => ['label' => 'Welcome (at check-in)',          'who' => '',        'at' => 'now'],
        'slides'  => ['label' => 'Slides and prompts (day +1)',    'who' => 'handout', 'at' => [1, '10:00']],
        'call'    => ['label' => 'Book your free call (day +2)',   'who' => 'call',    'at' => [2, '10:00']],
        'day3'    => ['label' => 'Challenge, day 3 (day +3)',      'who' => 'handout', 'at' => [3, '19:00']],
        'course'  => ['label' => 'AI Launchpad course (day +4)',   'who' => 'course',  'at' => [4, '10:00']],
        'day7'    => ['label' => 'Challenge, day 7 (day +7)',      'who' => 'handout', 'at' => [7, '10:00']],
    ];
}
function m_due($at) {
    if ($at === 'now') return m_now();
    $tz = new DateTimeZone('Africa/Cairo');
    $d = new DateTime(EVENT_DATE . ' ' . $at[1], $tz);
    $d->modify('+' . (int)$at[0] . ' day');
    return max($d->getTimestamp(), m_now() + 60); // someone joining late still gets it, a minute later
}
function m_cfg() { $c = m_load('mailcfg.json'); foreach (m_types() as $k => $t) if (!isset($c[$k])) $c[$k] = true; return $c; }
function m_wants($r, $who) {
    if (empty($r['email']) || !empty($r['unsub'])) return false;
    return $who === '' ? true : !empty($r['wants'][$who]);
}

// Queue every email this person qualifies for and doesn't have yet. Safe to call on every check-in.
function m_enqueue($r) {
    if (empty($r['email'])) return;
    $now = m_now();
    m_edit('mailq.json', function ($q) use ($r, $now) {
        foreach (m_types() as $type => $t) {
            $key = $r['id'] . ':' . $type;
            if (isset($q[$key])) continue;
            if (!m_wants($r, $t['who'])) continue;
            $q[$key] = ['pid' => $r['id'], 'type' => $type, 'due' => m_due($t['at']), 'status' => 'queued', 'tries' => 0, 'added' => $now];
        }
        return $q;
    });
}

// Send what is due. Consent is checked again at send time, so unticking or unsubscribing stops later emails.
function m_process($limit = 40, $onlyPid = null) {
    $people = m_load('checkins.json');
    $cfg = m_cfg();
    $types = m_types();
    $now = m_now();
    $todo = [];
    // An item stuck in 'sending' for 10+ minutes (a crash mid-send) goes back to the queue.
    m_edit('mailq.json', function ($q) use ($now) { foreach ($q as $k => $it) if ($it['status'] === 'sending' && ($it['claimedAt'] ?? 0) < $now - 600) $q[$k]['status'] = 'queued'; return $q; });
    foreach (m_load('mailq.json') as $key => $it) {
        if ($it['status'] !== 'queued' || $it['due'] > $now) continue;
        if ($onlyPid !== null && $it['pid'] !== $onlyPid) continue;
        $todo[$key] = $it;
        if (count($todo) >= $limit) break;
    }
    $sent = 0; $skipped = 0; $failed = 0;
    foreach ($todo as $key => $it) {
        $r = $people[$it['pid']] ?? null;
        $type = $it['type'];
        $result = null;
        if (!$r || !isset($types[$type]) || !m_wants($r, $types[$type]['who'])) { $result = ['status' => 'skipped', 'note' => 'no longer wanted']; $skipped++; }
        elseif (empty($cfg[$type])) { $result = ['status' => 'skipped', 'note' => 'turned off in admin']; $skipped++; }
        elseif (BREVO_API_KEY === '') { continue; } // wait for the key; nothing is lost
        else {
            // Claim the item first so a second runner (cron + check-in at the same moment) can't send it twice.
            $claimed = false;
            m_edit('mailq.json', function ($q) use ($key, $now, &$claimed) { if (isset($q[$key]) && $q[$key]['status'] === 'queued') { $q[$key]['status'] = 'sending'; $q[$key]['claimedAt'] = $now; $claimed = true; } return $q; });
            if (!$claimed) continue;
            $mail = m_render($type, $r);
            $res = m_send($r['email'], $r['name'], $mail['subject'], $mail['html'], $mail['text']);
            if ($res['ok']) { $result = ['status' => 'sent', 'sentAt' => $now]; $sent++; }
            else {
                $tries = $it['tries'] + 1;
                $result = $tries >= 3 ? ['status' => 'failed', 'tries' => $tries, 'note' => $res['error']] : ['status' => 'queued', 'tries' => $tries, 'due' => $now + 900, 'note' => $res['error']];
                $failed++;
            }
        }
        m_edit('mailq.json', function ($q) use ($key, $result) { if (isset($q[$key])) $q[$key] = array_merge($q[$key], $result); return $q; });
    }
    return ['sent' => $sent, 'skipped' => $skipped, 'failed' => $failed, 'waiting' => BREVO_API_KEY === ''];
}

function m_send($to, $name, $subject, $html, $text) {
    $url = getenv('WS_BREVO_URL') ?: 'https://api.brevo.com/v3/smtp/email'; // tests point this at a local fake
    $body = json_encode([
        'sender' => ['name' => MAIL_FROM_NAME, 'email' => MAIL_FROM],
        'replyTo' => ['email' => MAIL_FROM, 'name' => MAIL_FROM_NAME],
        'to' => [['email' => $to, 'name' => $name]],
        'subject' => $subject, 'htmlContent' => $html, 'textContent' => $text,
        'tags' => ['workshop'],
    ], JSON_UNESCAPED_UNICODE);
    if (!function_exists('curl_init')) return ['ok' => false, 'error' => 'curl is not available on this server'];
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15,
        CURLOPT_HTTPHEADER => ['accept: application/json', 'content-type: application/json', 'api-key: ' . BREVO_API_KEY]]);
    $out = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); $err = curl_error($ch);
    if ($code >= 200 && $code < 300) return ['ok' => true];
    $msg = $err ?: ('Brevo said ' . $code . ': ' . substr((string)$out, 0, 200));
    return ['ok' => false, 'error' => $msg];
}

// ---- Unsubscribe ----
function m_token($pid) { return substr(hash_hmac('sha256', 'unsub:' . $pid, ADMIN_KEY), 0, 20); }
function m_unsub_url($pid) { return SITE_URL . 'unsub.php?u=' . rawurlencode($pid) . '&t=' . m_token($pid); }

// ---- Templates ----
function m_wa() { return 'https://wa.me/' . preg_replace('/\D/', '', CONTACT_WHATSAPP); }
// ---- Email design ----
// One table-based layout for every email (workshop and Academy): it renders the same in Gmail, Outlook and Apple Mail.
// $c = ['pre' => preview line, 'label' => small header tag, 'title' => headline, 'body' => HTML paragraphs, 'cta' => [url, label],
//       'after' => HTML after the button, 'why' => why they get it, 'unsub' => unsubscribe URL or '']
function m_layout($c) {
    $font = "font-family:Arial,Helvetica,sans-serif";
    $btn = '';
    if (!empty($c['cta'])) {
        $btn = '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 8px"><tr><td bgcolor="#17322A" style="border-radius:999px">'
            . '<a href="' . m_h($c['cta'][0]) . '" style="display:inline-block;padding:15px 28px;' . $font . ';font-size:16px;font-weight:bold;color:#F4EFE3;text-decoration:none;border-radius:999px">' . m_h($c['cta'][1]) . ' &rarr;</a></td></tr></table>';
    }
    $link = function ($href, $label) { return '<a href="' . m_h($href) . '" style="color:#17322A;text-decoration:underline">' . m_h($label) . '</a>'; };
    $sig = '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;border-top:1px solid #E6DECB;padding-top:20px;width:100%"><tr>'
        . '<td width="52" valign="top" style="padding-top:20px"><div style="width:44px;height:44px;border-radius:50%;background:#17322A;color:#D9B86A;font:bold 16px Georgia,serif;line-height:44px;text-align:center">AT</div></td>'
        . '<td valign="top" style="padding:20px 0 0 12px;' . $font . ';font-size:14px;line-height:1.5;color:#5A6070"><b style="color:#1E2430;font-size:15px">Ahmed Tahoun</b><br>AI consultant &amp; trainer · Tahoun AI Academy<br>'
        . $link(m_wa(), 'WhatsApp') . ' &nbsp;·&nbsp; ' . $link(CONTACT_LINKEDIN, 'LinkedIn') . ' &nbsp;·&nbsp; ' . $link(CONTACT_WEBSITE, 'Website') . '</td></tr></table>';
    $foot = m_h($c['why'] ?? '') . (!empty($c['unsub']) ? '<br><a href="' . m_h($c['unsub']) . '" style="color:#8A8474;text-decoration:underline">Unsubscribe</a>' : '');
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>' . m_h($c['title']) . '</title></head>'
        . '<body style="margin:0;padding:0;background:#F4EFE3">'
        . '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#F4EFE3">' . m_h($c['pre'] ?? '') . str_repeat('&#8203;&nbsp;', 30) . '</div>'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F4EFE3"><tr><td align="center" style="padding:24px 12px">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:580px">'
        . '<tr><td bgcolor="#17322A" style="border-radius:16px 16px 0 0;padding:20px 28px"><span style="font:600 22px Georgia,serif;color:#F4EFE3">Tahoun <span style="color:#D9B86A">AI</span></span>'
        . '<span style="float:right;' . $font . ';font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#D9B86A;line-height:30px">' . m_h($c['label'] ?? '') . '</span></td></tr>'
        . '<tr><td bgcolor="#FFFDF8" style="border:1px solid #E6DECB;border-top:0;border-radius:0 0 16px 16px;padding:30px 28px 28px;' . $font . ';font-size:16px;line-height:1.6;color:#1E2430">'
        . '<h1 style="margin:0 0 16px;font:600 27px/1.2 Georgia,serif;color:#1E2430">' . m_h($c['title']) . '</h1>'
        . $c['body'] . $btn . ($c['after'] ?? '') . $sig
        . '</td></tr>'
        . '<tr><td style="padding:18px 8px;' . $font . ';font-size:12px;line-height:1.6;color:#8A8474;text-align:center">' . $foot . '</td></tr>'
        . '</table></td></tr></table></body></html>';
}
function m_p($s) { return '<p style="margin:0 0 14px">' . $s . '</p>'; }
function m_list($items) {
    $o = '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 14px;width:100%">';
    foreach ($items as $it) $o .= '<tr><td width="26" valign="top" style="color:#2E6B4A;font-weight:bold;padding:3px 0">&#10003;</td><td style="padding:3px 0">' . $it . '</td></tr>';
    return $o . '</table>';
}
function m_text($c) { // plain-text version for clients that don't show HTML
    $body = preg_replace('/<a href="([^"]+)"[^>]*>([^<]*)<\/a>/', '$2 ($1)', $c['body'] . ($c['after'] ?? ''));
    $t = trim(html_entity_decode(strip_tags(str_replace(['<br>', '</p>', '</tr>'], ["\n", "\n\n", "\n"], $body)), ENT_QUOTES, 'UTF-8'));
    $t = preg_replace("/[ \t]+/", ' ', $t);
    return $c['title'] . "\n\n" . $t . (!empty($c['cta']) ? "\n\n" . $c['cta'][1] . ': ' . $c['cta'][0] : '')
        . "\n\nAhmed Tahoun\nAI consultant & trainer · Tahoun AI Academy\nWhatsApp: " . m_wa() . "\nLinkedIn: " . CONTACT_LINKEDIN
        . (!empty($c['unsub']) ? "\n\nUnsubscribe: " . $c['unsub'] : '');
}

function m_render($type, $r) {
    $n = m_h($r['name'] ?: 'there');
    $app = SITE_URL;
    $wa = m_wa();
    $rated = !empty($r['fb']);
    $c = ['label' => 'Free workshop · Dahab', 'why' => 'You get this because you checked in at ' . EVENT_NAME . ' and asked for it.', 'unsub' => m_unsub_url($r['id'])];
    switch ($type) {
        case 'welcome':
            $c += ['title' => "You're in, $n!", 'pre' => 'Your workshop app: slides, prompt builder, live game and your kit.',
                'body' => m_p('Welcome to <b>Brief Your AI</b>, the free AI workshop in Dahab. Keep this email: your workshop app is one tap away, during the session and after it.')
                    . m_list(['<b>Slides</b> for every part, as we go', '<b>Prompt builder</b> for the exercises', '<b>Live game</b> and the final quiz', '<b>Your kit</b>: every prompt, examples for your work, and a 7-day plan']),
                'cta' => [$app, 'Open the workshop app'], 'after' => m_p('See you in the room!')];
            break;
        case 'slides':
            $c += ['title' => 'Your slides, prompts and 7-day plan', 'pre' => 'Everything from yesterday, in one place. Day 1 of your challenge starts today.',
                'body' => m_p("Hi $n, thank you for coming to the free workshop yesterday. As promised, everything is in your workshop app:")
                    . m_list(['<b>Slides</b>: every slide from the session', '<b>Kit</b>: all prompts, 8 tricks to try at home, examples for your work', '<b>7-day challenge</b>: 10 minutes a day. Day 1: brief one real email with Who · Why · What · How · Don’t']),
                'cta' => [$app, 'Open your slides and kit'],
                'after' => ($rated ? '' : m_p('One small favour: if you haven’t rated the workshop yet, it takes 30 seconds in the Kit tab and shapes the next one.'))
                    . m_p('Want more? I run new hands-on workshops in Dahab, and private ones for teams. <a href="' . m_h(m_wa()) . '" style="color:#17322A">Message me on WhatsApp</a> to get a seat at the next one.')];
            break;
        case 'call':
            $c += ['title' => "Let's look at your AI plan together", 'pre' => 'Your free 20-minute call: pick a time that suits you.',
                'body' => m_p("Hi $n, you asked for a free 20-minute call, so let’s book it.")
                    . m_p('Bring the upgrade plan you made in the workshop (Kit → Part 4). I’ll tell you honestly which step is worth doing first, and what it would take.'),
                'cta' => [$wa, 'Pick a time on WhatsApp'], 'after' => m_p('Or simply reply to this email with two times that work for you.')];
            break;
        case 'day3':
            $c += ['title' => "Day 3: how's your AI week going?", 'pre' => 'Today’s 10-minute challenge, and an offer if you’re stuck.',
                'body' => m_p("Hi $n, quick check-in on your 7-day challenge.") . m_p('<b>Today:</b> research one topic your clients care about, with web search turned on, and open the sources.')
                    . m_p('Stuck on a task? Reply with what you tried, and I’ll send you a better brief.'),
                'cta' => [$app, 'Open your kit']];
            break;
        case 'course':
            $c += ['title' => 'AI Launchpad: the 4-week course', 'pre' => 'Live, small group, founding price for the first 15 seats.',
                'body' => m_p("Hi $n, you asked about the course, so here it is.")
                    . m_list(['<b>4 weeks, live, in a small group</b>', 'From your first good prompt to your own AI assistant for your work or business', '<b>Founding price $199</b> for the first 15 seats (then $349)']),
                'cta' => [$wa, 'Ask for the dates on WhatsApp'], 'after' => m_p('Have a question first? Just reply to this email.')];
            break;
        case 'day7':
        default:
            $c += ['title' => 'Day 7: count your saved minutes', 'pre' => 'The last day of your challenge, and what comes next.',
                'body' => m_p("Hi $n, it’s the last day of the challenge. Add up the minutes AI saved you this week, and tell someone.")
                    . m_p('If it’s more than an hour, imagine a system doing those tasks without anyone typing. That’s step 4 of the ladder, and it’s what I build.'),
                'cta' => [$wa, 'Book a free 20-minute call'], 'after' => m_p('Thank you for being part of the first one.')];
            break;
    }
    $subjects = ['welcome' => "You're in, " . ($r['name'] ?: 'there') . "! Your workshop app", 'slides' => 'Your slides, prompts and 7-day plan', 'call' => "Let's look at your AI plan together",
        'day3' => "Day 3: how's your AI week going?", 'course' => 'AI Launchpad: the 4-week course', 'day7' => 'Day 7: count your saved minutes'];
    return ['subject' => $subjects[$type] ?? $c['title'], 'html' => m_layout($c), 'text' => m_text($c)];
}
