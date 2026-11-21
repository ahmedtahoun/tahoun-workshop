<?php
// Tahoun AI Academy API: course sign-up, progress, the graded final quiz, certificates, and track enquiries.
require __DIR__ . '/lib.php';

$LESSONS = ['what-ai-is', 'the-brief', 'thinking-partner', 'upgrade', 'safety'];
$FINAL = [1, 1, 2, 0, 2]; // right option per final-quiz question (graded here, never trusted from the phone)
$TYPES = ['workshop' => 'Next workshop', 'launchpad' => 'AI Launchpad waitlist', 'freelance' => 'AI for freelancers', 'business' => 'AI for business owners', 'corporate' => 'Team / corporate training'];

$action = $_GET['action'] ?? '';
$in = json_decode((string)file_get_contents('php://input'), true);
if (!is_array($in)) $in = [];

function a_public($r) {
    return ['id' => $r['id'], 'name' => $r['name'], 'done' => $r['done'] ?? (object)[], 'cert' => $r['cert'] ?? null, 'token' => a_token($r['id'])];
}

// The free course is retired: no new sign-ups.
if (in_array($action, ['join', 'progress', 'final'], true)) a_out(['ok' => false, 'error' => 'The free course has closed. Join the next workshop instead.'], 410);

if ($action === 'join' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!empty($in['website'])) a_out(['ok' => true]); // spam trap
    a_rate();
    $id = a_id($in['id'] ?? ''); if (strlen($id) < 8 || strlen($id) > 40) $id = bin2hex(random_bytes(8));
    $name = a_cut($in['name'] ?? '', 60);
    if ($name === '') a_out(['ok' => false, 'error' => 'Please add your first name.'], 400);
    $email = a_cut($in['email'] ?? '', 120);
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) a_out(['ok' => false, 'error' => 'That email doesn’t look right.'], 400);
    $phone = a_phone($in['phone'] ?? '');
    $pd = strlen(preg_replace('/\D/', '', $phone));
    if ($phone !== '' && ($pd < 8 || $pd > 15)) a_out(['ok' => false, 'error' => 'That WhatsApp number doesn’t look complete. Include the country code.'], 400);
    if ($email === '' && $phone === '') a_out(['ok' => false, 'error' => 'Add your email or WhatsApp so you can get your certificate and come back later.'], 400);
    $isNew = false; $rec = null;
    a_edit('learners.json', function ($d) use ($id, $name, $email, $phone, &$isNew, &$rec) {
        $old = $d[$id] ?? null; $isNew = $old === null;
        $rec = array_merge($old ?: ['id' => $id, 'done' => [], 'joined' => date('c')], ['name' => $name, 'email' => $email, 'phone' => $phone, 'source' => a_cut($_GET['src'] ?? ($old['source'] ?? ''), 30), 'seen' => date('c')]);
        $d[$id] = $rec; return $d;
    });
    if ($isNew && $email !== '') {
        $resume = ACADEMY_URL . 'course.html?u=' . $id . '&t=' . a_token($id);
        a_mail($email, $name, 'Your free course: Brief Your AI', ['title' => 'Welcome to Brief Your AI, ' . m_h($name) . '!', 'pre' => 'Five short lessons, a quiz and a certificate of completion. Your progress link is inside.',
            'body' => m_p('Five short lessons, about 45 minutes in total. Go at your own pace.') . m_list(['How AI really works and where its answers come from', 'The five-line brief that fixes bad answers', 'AI as your thinking partner', 'The upgrade ladder for your work', 'Using it safely']),
            'cta' => [$resume, 'Continue the course'], 'after' => m_p('This button opens your course with your progress, on any device.'), 'unsub' => a_unsub($id)]);
    }
    a_out(['ok' => true] + a_public($rec));
}

if ($action === 'me') { // resume on another device with the emailed link
    $id = a_id($_GET['u'] ?? ''); $t = (string)($_GET['t'] ?? '');
    $d = a_load('learners.json');
    if (!$id || !isset($d[$id]) || !hash_equals(a_token($id), $t)) a_out(['ok' => false, 'error' => 'This link isn’t valid any more. Start again below; it takes 20 seconds.'], 404);
    a_out(['ok' => true] + a_public($d[$id]));
}

if ($action === 'progress' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $id = a_id($in['id'] ?? ''); $lesson = (string)($in['lesson'] ?? '');
    if (!in_array($lesson, $LESSONS, true)) a_out(['ok' => false, 'error' => 'Unknown lesson.'], 400);
    $found = false;
    a_edit('learners.json', function ($d) use ($id, $lesson, &$found) { if (isset($d[$id])) { $d[$id]['done'][$lesson] = date('c'); $found = true; } return $d; });
    a_out($found ? ['ok' => true] : ['ok' => false, 'error' => 'Please sign up at the top of the course first.'], $found ? 200 : 400);
}

if ($action === 'final' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $id = a_id($in['id'] ?? ''); $ans = is_array($in['answers'] ?? null) ? $in['answers'] : [];
    $score = 0; foreach ($FINAL as $i => $right) if (isset($ans[$i]) && (int)$ans[$i] === $right) $score++;
    $d = a_load('learners.json');
    if (!isset($d[$id])) a_out(['ok' => false, 'error' => 'Please sign up at the top of the course first.'], 400);
    $missing = array_values(array_diff($LESSONS, array_keys($d[$id]['done'] ?? [])));
    if ($missing) a_out(['ok' => false, 'score' => $score, 'error' => 'Finish all five lessons first, then take the final quiz.'], 400);
    if ($score < CERT_PASS) a_out(['ok' => true, 'score' => $score, 'passed' => false]);
    $cert = null; $isNew = false;
    a_edit('learners.json', function ($d) use ($id, $score, &$cert, &$isNew) {
        if (empty($d[$id]['cert'])) {
            $alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; $c = ''; for ($i = 0; $i < 8; $i++) $c .= $alpha[random_int(0, strlen($alpha) - 1)];
            $d[$id]['cert'] = ['id' => $c, 'name' => $d[$id]['name'], 'score' => $score, 'date' => date('Y-m-d')]; $isNew = true;
        }
        $cert = $d[$id]['cert']; return $d;
    });
    if ($isNew) {
        a_edit('certs.json', function ($c) use ($cert, $id) { $c[$cert['id']] = $id; return $c; });
        $r = a_load('learners.json')[$id];
        if (!empty($r['email'])) a_mail($r['email'], $r['name'], 'Your certificate: Brief Your AI', ['title' => 'Congratulations, ' . m_h($r['name']) . '!', 'pre' => 'You completed Brief Your AI. Your certificate of completion is ready.',
            'body' => m_p('You completed <b>Brief Your AI</b> with <b>' . (int)$cert['score'] . '/5</b> on the final quiz. Your certificate of completion has its own page that anyone can check, and you can add it to LinkedIn from there.')
                . m_p('<span style="color:#5A6070;font-size:14px">It shows you completed this free course. It isn’t an official or accredited certification.</span>'),
            'cta' => [ACADEMY_URL . 'verify.php?c=' . $cert['id'], 'See your certificate'],
            'after' => m_p('Want to go further? The AI Launchpad live cohort is next. Reply to this email or message me on WhatsApp.'), 'unsub' => a_unsub($id)]);
    }
    a_out(['ok' => true, 'score' => $score, 'passed' => true, 'cert' => $cert]);
}

if ($action === 'lead' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!empty($in['website'])) a_out(['ok' => true]);
    a_rate();
    $type = (string)($in['type'] ?? '');
    if (!isset($TYPES[$type])) a_out(['ok' => false, 'error' => 'Pick what you’re interested in.'], 400);
    $name = a_cut($in['name'] ?? '', 60); if ($name === '') a_out(['ok' => false, 'error' => 'Please add your name.'], 400);
    $email = a_cut($in['email'] ?? '', 120);
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) a_out(['ok' => false, 'error' => 'That email doesn’t look right.'], 400);
    $phone = a_phone($in['phone'] ?? ''); $pd = strlen(preg_replace('/\D/', '', $phone));
    if ($phone !== '' && ($pd < 8 || $pd > 15)) a_out(['ok' => false, 'error' => 'That WhatsApp number doesn’t look complete. Include the country code.'], 400);
    if ($email === '' && $phone === '') a_out(['ok' => false, 'error' => 'Add your email or WhatsApp so I can reply.'], 400);
    $lead = ['id' => bin2hex(random_bytes(6)), 'type' => $type, 'name' => $name, 'email' => $email, 'phone' => $phone,
        'company' => a_cut($in['company'] ?? '', 100), 'team' => a_cut($in['team'] ?? '', 20), 'goal' => a_cut($in['goal'] ?? '', 600), 'at' => date('c')];
    a_edit('leads.json', function ($l) use ($lead) { $l[] = $lead; return $l; });
    // Tell Ahmed straight away.
    a_mail(MAIL_FROM, MAIL_FROM_NAME, 'New Academy enquiry: ' . $TYPES[$type] . ' from ' . $name, ['label' => 'New lead', 'title' => $TYPES[$type], 'pre' => $name . ($lead['company'] !== '' ? ' · ' . $lead['company'] : ''),
        'body' => m_p('<b>' . m_h($name) . '</b>' . ($lead['company'] !== '' ? ' · ' . m_h($lead['company']) : '') . ($lead['team'] !== '' ? ' · team of ' . m_h($lead['team']) : ''))
            . m_p(($email !== '' ? 'Email: ' . m_h($email) . '<br>' : '') . ($phone !== '' ? 'WhatsApp: ' . m_h($phone) : '')) . ($lead['goal'] !== '' ? m_p('“' . nl2br(m_h($lead['goal'])) . '”') : ''),
        'cta' => $phone !== '' ? ['https://wa.me/' . preg_replace('/\D/', '', $phone), 'Reply on WhatsApp'] : ['mailto:' . $email, 'Reply by email'], 'why' => 'Sent to you by your Academy site.']);
    // And reply to the person instantly, so nobody waits wondering.
    if ($email !== '') {
        $next = [
            'workshop'  => ['You’re on the list for the next workshop', 'I’ll send you the date and place of the next Brief Your AI workshop as soon as it’s set. Seats are limited, so you’ll hear before I post it anywhere.', 'Message me on WhatsApp', m_wa()],
            'launchpad' => ['You’re on the AI Launchpad waitlist', 'Founding seats are limited to 15 at $199 (then $349). I’ll send you the dates before anyone else.', 'Message me on WhatsApp', m_wa()],
            'freelance' => ['You’re on the list for AI for freelancers', 'I’ll tell you as soon as the freelancer track opens: outreach, scoping, pricing and delivering AI projects.', 'Message me on WhatsApp', m_wa()],
            'business'  => ['Let’s book your free 20-minute call', 'Tell me two times that suit you, and bring the one task that takes the most time in your business. I’ll tell you honestly what AI can do for it.', 'Pick a time on WhatsApp', m_wa()],
            'corporate' => ['Thanks for asking about team training', 'I’ll reply personally with a short proposal: the format, the topics for your team and the price. If it’s easier to talk first, message me on WhatsApp.', 'Message me on WhatsApp', m_wa()],
        ][$type];
        a_mail($email, $name, $next[0], ['title' => $next[0], 'pre' => 'Thanks ' . $name . ', here’s what happens next.',
            'body' => m_p('Hi ' . m_h($name) . ', thank you for getting in touch.') . m_p($next[1]), 'cta' => [$next[3], $next[2]],
            'after' => m_p('I reply personally, usually the same day.'), 'why' => 'You get this because you sent an enquiry at Tahoun AI Academy.']);
    }
    a_out(['ok' => true]);
}

if ($action === 'export') {
    if (!a_admin()) a_out(['ok' => false, 'error' => 'Not allowed.'], 403);
    $what = ($_GET['what'] ?? '') === 'leads' ? 'leads' : 'learners';
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="academy-' . $what . '.csv"');
    $o = fopen('php://output', 'w'); fwrite($o, "\xEF\xBB\xBF");
    $safe = function ($row) { return array_map(function ($v) { return preg_match('/^[=+\-@]/', (string)$v) ? "'" . $v : $v; }, $row); };
    if ($what === 'leads') {
        fputcsv($o, ['Interest', 'Name', 'Company', 'Team size', 'Email', 'WhatsApp', 'Goal', 'Date'], ',', '"', '');
        foreach (a_load('leads.json') as $l) fputcsv($o, $safe([$TYPES[$l['type']] ?? $l['type'], $l['name'], $l['company'], $l['team'], $l['email'], $l['phone'] !== '' ? 'https://wa.me/' . preg_replace('/\D/', '', $l['phone']) : '', $l['goal'], $l['at']]), ',', '"', '');
    } else {
        fputcsv($o, ['Name', 'Email', 'WhatsApp', 'Lessons done', 'Certificate', 'Score', 'From', 'Joined'], ',', '"', '');
        foreach (a_load('learners.json') as $r) fputcsv($o, $safe([$r['name'], $r['email'], ($r['phone'] ?? '') !== '' ? 'https://wa.me/' . preg_replace('/\D/', '', $r['phone']) : '', count($r['done'] ?? []) . '/5', $r['cert']['id'] ?? '', isset($r['cert']) ? $r['cert']['score'] . '/5' : '', $r['source'] ?? '', $r['joined']]), ',', '"', '');
    }
    exit;
}

a_out(['ok' => false, 'error' => 'Not found.'], 404);
