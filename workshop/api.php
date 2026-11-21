<?php
// Workshop check-in API. Data lives in data/checkins.json (blocked from the web by data/.htaccess).
ini_set('display_errors', '0'); // a server warning must never break the app's JSON
require __DIR__ . '/config.php';
require_once __DIR__ . '/mail.php';
header('Cache-Control: no-store');

$DATA = getenv('WS_DATA_DIR') ?: __DIR__ . '/data'; // local testing can point this elsewhere
$FILE = $DATA . '/checkins.json';
$LEVELS = ['new', 'some', 'daily'];
$GAMEF = $DATA . '/game.json';
// Hours-a-week bands and the midpoint used for the room total.
$HOURS = ['0-2' => 1, '3-5' => 4, '6-10' => 8, '11-20' => 15, '20+' => 25];
$LIMIT = 20; // seconds per game question

// Game questions: o = options, a = index of the right answer, why = one line shown after the reveal.
$QS = [
    ['q' => '“Write a post about my yoga studio.” Is this a good brief?', 'o' => ['Good brief', 'Bad brief'], 'a' => 1, 'why' => 'No who, why, how or don’t. The AI has to guess everything.'],
    ['q' => '“You’re a copywriter. Write a launch email. Under 100 words, no hype.” Which part is missing?', 'o' => ['Who', 'Why', 'How', 'Don’t'], 'a' => 1, 'why' => 'Why: the situation only you know. Who is it for, and what are you launching?'],
    ['q' => 'Today’s exchange rate, euro to Egyptian pound. Where should the answer come from?', 'o' => ['AI memory', 'Web search', 'Deep research'], 'a' => 1, 'why' => 'It changes every day. Turn on search and check the source.'],
    ['q' => 'Rewrite your email so it sounds warmer. What does the AI need?', 'o' => ['AI memory', 'Web search', 'Deep research'], 'a' => 0, 'why' => 'Writing and rewriting need no search. Your email is the facts.'],
    ['q' => 'Compare 5 booking apps for your business before you pay for one.', 'o' => ['AI memory', 'Web search', 'Deep research'], 'a' => 2, 'why' => 'A money decision with many sources: deep research, then read the sources.'],
    ['q' => 'The AI says your business plan is brilliant. Best next prompt?', 'o' => ['“Thank you!”', '“List the 3 biggest reasons it could fail.”', '“Make it longer.”'], 'a' => 1, 'why' => 'AI tends to agree with you. Ask it to push back.'],
    ['q' => 'Safe to paste a client’s name and medical notes into a public AI tool?', 'o' => ['Yes, it’s private', 'No, remove personal details first', 'Only on weekends'], 'a' => 1, 'why' => 'Swap names for [Client A] and leave health details out.'],
    ['q' => 'The first answer is okay, not great. What do you do?', 'o' => ['Accept it', 'Start a new chat', 'Reply with feedback: “Shorter, warmer.”'], 'a' => 2, 'why' => 'Never keep the first draft. The conversation is where quality comes from.'],
    // Hard finish: 30 seconds and double points. t = seconds, x = points multiplier.
    ['q' => 'You ask the same question twice and get two different answers. Why?', 'o' => ['It’s broken', 'It picks likely words, with a little randomness', 'It searched the web again', 'It learned from your last chat'], 'a' => 1, 'why' => 'AI predicts the next likely word, with some chance in each pick. Same question, different wording, so always check.', 't' => 30, 'x' => 2],
    ['q' => 'You paste a 40-page report and ask for a summary. Where is AI most likely to miss things?', 'o' => ['The first pages', 'The middle pages', 'The last pages', 'Nowhere, it reads everything equally'], 'a' => 1, 'why' => 'Models pay most attention to the start and the end. Ask for a summary section by section.', 't' => 30, 'x' => 2],
];
$PAUSE = 4; // seconds each player sees their result before the next question

// ---- Self-paced game: everyone starts together, each player moves on as soon as they answer. ----
// game.json: phase idle|open|done, startedAt, answers[q][pid] = {c, t}, prog[pid] = {q: next question, at: when it opens}
function qlim($i) { global $QS, $LIMIT; return (int)($QS[$i]['t'] ?? $LIMIT); }
function qpts($i, $a) {
    global $QS;
    if (!isset($QS[$i]) || (int)$a['c'] !== $QS[$i]['a']) return 0;
    $lim = qlim($i);
    return (int)round((500 + 500 * (1 - min($a['t'], $lim) / $lim)) * ($QS[$i]['x'] ?? 1));
}
// Make sure this player is in the race and skip any questions they ran out of time on. Returns true if $g changed.
function game_tick(&$g, $pid, $now) {
    global $QS, $PAUSE;
    if (($g['phase'] ?? '') !== 'open' || !$pid) return false;
    $n = count($QS);
    $changed = false;
    if (!isset($g['prog'][$pid])) {
        $start = (float)($g['startedAt'] ?? $now);
        $g['prog'][$pid] = ['q' => 0, 'at' => ($now - $start > qlim(0)) ? $now : $start]; // late joiners get a full first question
        $changed = true;
    }
    $p = &$g['prog'][$pid];
    while ($p['q'] < $n && $now >= $p['at'] && $now - $p['at'] > qlim($p['q']) + 1.5) {
        $g['answers'][$p['q']][$pid] = ['c' => -1, 't' => qlim($p['q'])];
        $p['at'] = $p['at'] + qlim($p['q']) + 1.5 + $PAUSE;
        $p['q']++;
        $changed = true;
    }
    unset($p);
    return $changed;
}
function game_tick_all(&$g, $now) {
    $changed = false;
    foreach (array_keys($g['prog'] ?? []) as $id) if (game_tick($g, (string)$id, $now)) $changed = true;
    return $changed;
}
// End the game on its own once every player has finished and seen their last result.
function game_autodone(&$g, $now) {
    global $QS;
    if (($g['phase'] ?? '') !== 'open' || empty($g['prog'])) return false;
    foreach ($g['prog'] as $p) if ($p['q'] < count($QS) || $now < $p['at']) return false;
    $g['phase'] = 'done';
    $g['endedAt'] = $now;
    return true;
}
// Points per player (also used by the CSV export).
function game_points($g) {
    $p = [];
    foreach (($g['answers'] ?? []) as $q => $ans) foreach ($ans as $pid => $a) $p[$pid] = ($p[$pid] ?? 0) + qpts((int)$q, $a);
    return $p;
}
// Ranking: most points first; on a tie, less total answer time wins.
function game_rank($g) {
    $rows = [];
    foreach (($g['prog'] ?? []) as $pid => $pr) $rows[$pid] = ['pts' => 0, 'time' => 0.0, 'q' => (int)$pr['q'], 'right' => 0];
    foreach (($g['answers'] ?? []) as $q => $ans) foreach ($ans as $pid => $a) {
        if (!isset($rows[$pid])) $rows[$pid] = ['pts' => 0, 'time' => 0.0, 'q' => 0, 'right' => 0];
        $pts = qpts((int)$q, $a);
        $rows[$pid]['pts'] += $pts;
        $rows[$pid]['time'] += (float)$a['t'];
        if ($pts > 0) $rows[$pid]['right']++;
    }
    uasort($rows, function ($a, $b) { return $b['pts'] <=> $a['pts'] ?: $a['time'] <=> $b['time']; });
    return $rows;
}

function game_view($g, $pid, $QS, $people, $admin) {
    global $PAUSE;
    $now = microtime(true);
    $gp = $g['phase'] ?? 'idle';
    $n = count($QS);
    $v = ['g' => $gp, 'phase' => $gp, 'total' => $n, 'players' => count($g['prog'] ?? []), 'limit' => qlim(0)];
    if ($gp === 'idle') return $v;
    $fin = 0;
    foreach (($g['prog'] ?? []) as $p) if ($p['q'] >= $n) $fin++;
    $v['finished'] = $fin;
    // Leaderboard (top 10: the whole room).
    $board = []; $i = 0; $rank = 0;
    foreach (game_rank($g) as $id => $r) {
        $i++;
        if ($id === $pid) { $rank = $i; $v['myScore'] = $r['pts']; $v['myTime'] = round($r['time'], 1); $v['myRight'] = $r['right']; }
        if (count($board) < 10) $board[] = ['name' => isset($people[$id]) ? $people[$id]['name'] : 'Guest', 'country' => ($people[$id]['country'] ?? '') === 'XX' ? '' : ($people[$id]['country'] ?? ''), 'points' => $r['pts'], 'time' => round($r['time'], 1), 'q' => min($r['q'], $n), 'me' => $id === $pid];
    }
    $v['rank'] = $rank;
    $v['board'] = $board;
    if ($pid && !isset($v['myScore'])) $v['myScore'] = 0;
    if ($gp === 'done' || !$pid || !isset($g['prog'][$pid])) return $v; // wall, host without check-in, or game over
    // This player's own screen.
    $p = $g['prog'][$pid];
    $streak = 0;
    for ($k = $p['q'] - 1; $k >= 0; $k--) { if (qpts($k, $g['answers'][$k][$pid] ?? ['c' => -1, 't' => 0]) > 0) $streak++; else break; }
    $v['streak'] = $streak;
    if ($p['q'] > 0 && $now < $p['at']) {
        // Short result screen for the question just answered.
        $q = $p['q'] - 1;
        $a = $g['answers'][$q][$pid] ?? ['c' => -1, 't' => qlim($q)];
        $v += ['phase' => 'reveal', 'q' => $q, 'question' => $QS[$q]['q'], 'options' => $QS[$q]['o'], 'correct' => $QS[$q]['a'], 'why' => $QS[$q]['why'],
            'mine' => (int)$a['c'] >= 0 ? (int)$a['c'] : null, 'myT' => $a['t'], 'gained' => qpts($q, $a), 'hard' => !empty($QS[$q]['x']), 'next' => max(0, $p['at'] - $now), 'last' => $p['q'] >= $n];
        $v['phase'] = 'reveal';
        return $v;
    }
    if ($p['q'] === 0 && $now < $p['at']) { $v['phase'] = 'countdown'; $v['q'] = 0; $v['next'] = $p['at'] - $now; return $v; }
    if ($p['q'] >= $n) { $v['phase'] = 'finished'; $v['q'] = $n; return $v; }
    $q = $p['q'];
    $v['phase'] = 'open';
    $v['q'] = $q;
    $v['question'] = $QS[$q]['q'];
    $v['options'] = $QS[$q]['o'];
    $v['limit'] = qlim($q);
    $v['remaining'] = max(0, qlim($q) - ($now - $p['at']));
    $v['hard'] = !empty($QS[$q]['x']);
    return $v;
}

function out($arr, $code = 200) {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($arr, JSON_UNESCAPED_UNICODE);
    exit;
}
function cut($s, $n) {
    $s = trim(preg_replace('/[\x00-\x1F\x7F]+/u', ' ', (string)$s));
    return function_exists('mb_substr') ? mb_substr($s, 0, $n) : substr($s, 0, $n);
}
function load($f) {
    if (!is_file($f)) return [];
    $d = json_decode((string)file_get_contents($f), true);
    return is_array($d) ? $d : [];
}
// Read-modify-write under an exclusive lock so two phones can't overwrite each other.
function edit($f, callable $fn) {
    $h = fopen($f, 'c+');
    if (!$h) out(['ok' => false, 'error' => 'The server could not save. Tell Ahmed.'], 500);
    flock($h, LOCK_EX);
    $d = json_decode((string)stream_get_contents($h), true);
    $d = $fn(is_array($d) ? $d : []);
    ftruncate($h, 0);
    rewind($h);
    fwrite($h, json_encode($d, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    fflush($h);
    flock($h, LOCK_UN);
    fclose($h);
    return $d;
}
function is_admin() {
    $k = (string)($_GET['key'] ?? $_POST['key'] ?? '');
    return $k !== '' && hash_equals(ADMIN_KEY, $k);
}

$action = $_GET['action'] ?? '';

if ($action === 'checkin' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $in = json_decode((string)file_get_contents('php://input'), true);
    if (!is_array($in)) out(['ok' => false, 'error' => 'Something went wrong. Try again.'], 400);
    if (!empty($in['website'])) out(['ok' => true]); // spam trap field, humans never fill it

    // Simple rate limit: 30 saves per hour per network.
    $now = time();
    $ipKey = hash('sha256', $_SERVER['REMOTE_ADDR'] ?? '');
    $blocked = false;
    edit($DATA . '/rate.json', function ($r) use ($ipKey, $now, &$blocked) {
        foreach ($r as $k => $times) {
            $r[$k] = array_values(array_filter($times, function ($t) use ($now) { return $t > $now - 3600; }));
            if (!$r[$k]) unset($r[$k]);
        }
        if (count($r[$ipKey] ?? []) >= 30) { $blocked = true; return $r; }
        $r[$ipKey][] = $now;
        return $r;
    });
    if ($blocked) out(['ok' => false, 'error' => 'Too many tries from this network. Wait a few minutes.'], 429);

    $id = preg_replace('/[^a-z0-9]/', '', strtolower((string)($in['id'] ?? '')));
    if (strlen($id) < 8 || strlen($id) > 40) $id = bin2hex(random_bytes(8));
    $name = cut($in['name'] ?? '', 60);
    if ($name === '') out(['ok' => false, 'error' => 'Please add your name.'], 400);
    $email = cut($in['email'] ?? '', 120);
    $phone = preg_replace('/[^0-9+]/', '', (string)($in['phone'] ?? ''));
    $phone = substr($phone, 0, 1) === '+' ? '+' . preg_replace('/\D/', '', $phone) : preg_replace('/\D/', '', $phone);
    $pdigits = strlen(preg_replace('/\D/', '', $phone));
    if ($phone !== '' && ($pdigits < 8 || $pdigits > 15)) out(['ok' => false, 'error' => 'That WhatsApp number doesn’t look complete. Include the country code.'], 400);
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) out(['ok' => false, 'error' => 'That email doesn’t look right. Check it or leave it empty.'], 400);
    $wants = [
        'handout' => !empty($in['wants']['handout']),
        'course'  => !empty($in['wants']['course']),
        'call'    => !empty($in['wants']['call']),
        'updates' => !empty($in['wants']['updates']),
    ];
    if ($email === '' && $phone === '' && ($wants['handout'] || $wants['course'] || $wants['call'] || $wants['updates'])) out(['ok' => false, 'error' => 'Add your WhatsApp or email so I can send you what you ticked.'], 400);
    $level = in_array($in['level'] ?? '', $LEVELS, true) ? $in['level'] : 'some';
    $hours = in_array($in['hours'] ?? '', array_keys($HOURS), true) ? $in['hours'] : '';
    $country = strtoupper((string)($in['country'] ?? ''));
    if (!preg_match('/^([A-Z]{2}|XX)$/', $country)) $country = ''; // XX = prefer not to say

    $rec = [
        'id' => $id,
        'name' => $name,
        'work' => cut($in['work'] ?? '', 120),
        'level' => $level,
        'hours' => $hours,
        'country' => $country,
        'task' => cut($in['task'] ?? '', 240),
        'question' => cut($in['question'] ?? '', 280),
        'email' => $email,
        'phone' => $phone,
        'wants' => $wants,
        'at' => date('c'),
    ];
    $saved = null;
    edit($FILE, function ($d) use ($rec, &$saved) {
        $old = $d[$rec['id']] ?? [];
        $rec['answered'] = $old['answered'] ?? false;
        $rec['hidden'] = $old['hidden'] ?? false;
        $rec['first'] = $old['first'] ?? $rec['at'];
        if (isset($old['quiz'])) $rec['quiz'] = $old['quiz'];
        if (isset($old['fb'])) $rec['fb'] = $old['fb'];
        if (!empty($old['unsub']) && $old['email'] === $rec['email']) $rec['unsub'] = true;
        $d[$rec['id']] = $rec;
        $saved = $rec;
        return $d;
    });
    // Queue their emails and send the welcome right away (if Brevo is set up). A mail problem never blocks check-in.
    try { if ($saved) { m_enqueue($saved); m_process(3, $saved['id']); } } catch (Throwable $e) {}
    out(['ok' => true, 'id' => $id]);
}

if ($action === 'wall') {
    $d = load($FILE);
    $admin = is_admin();
    $qs = [];
    $levels = ['new' => 0, 'some' => 0, 'daily' => 0];
    $hoursTotal = 0; $hoursN = 0; $countries = [];
    foreach ($d as $r) {
        if (isset($levels[$r['level'] ?? ''])) $levels[$r['level']]++;
        if (isset($HOURS[$r['hours'] ?? ''])) { $hoursTotal += $HOURS[$r['hours']]; $hoursN++; }
        $cc = $r['country'] ?? '';
        if ($cc !== '' && $cc !== 'XX') $countries[$cc] = ($countries[$cc] ?? 0) + 1;
        if (($r['question'] ?? '') === '') continue;
        if (!empty($r['hidden']) && !$admin) continue;
        // Questions are shown without names.
        $qs[] = ['id' => $r['id'], 'q' => $r['question'], 'answered' => !empty($r['answered']), 'hidden' => !empty($r['hidden']), 'at' => $r['first'] ?? $r['at']];
    }
    usort($qs, function ($a, $b) { return strcmp($a['at'], $b['at']); });
    $st = load($DATA . '/state.json');
    out(['ok' => true, 'count' => count($d), 'levels' => $levels, 'questions' => $qs, 'admin' => $admin, 'hours' => $hoursTotal, 'hoursN' => $hoursN, 'countries' => (object)$countries, 'step' => (int)($st['step'] ?? 0)]);
}

// Which part of the workshop we're in. Phones poll this to move their progress bar.
if ($action === 'state') {
    $st = load($DATA . '/state.json');
    out(['ok' => true, 'step' => (int)($st['step'] ?? 0)]);
}

if ($action === 'step' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!is_admin()) out(['ok' => false, 'error' => 'Not allowed.'], 403);
    $in = json_decode((string)file_get_contents('php://input'), true) ?: [];
    $step = max(0, min(6, (int)($in['step'] ?? 0)));
    edit($DATA . '/state.json', function ($s) use ($step) { $s['step'] = $step; $s['at'] = date('c'); return $s; });
    out(['ok' => true, 'step' => $step]);
}

if ($action === 'mark' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!is_admin()) out(['ok' => false, 'error' => 'Not allowed.'], 403);
    $in = json_decode((string)file_get_contents('php://input'), true) ?: [];
    $id = preg_replace('/[^a-z0-9]/', '', (string)($in['id'] ?? ''));
    $field = in_array($in['field'] ?? '', ['answered', 'hidden'], true) ? $in['field'] : null;
    if (!$id || !$field) out(['ok' => false, 'error' => 'Bad request.'], 400);
    edit($FILE, function ($d) use ($id, $field) {
        if (isset($d[$id])) $d[$id][$field] = empty($d[$id][$field]);
        return $d;
    });
    out(['ok' => true]);
}

if ($action === 'export') {
    if (!is_admin()) out(['ok' => false, 'error' => 'Not allowed.'], 403);
    $d = load($FILE);
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="workshop-checkins.csv"');
    $o = fopen('php://output', 'w');
    fwrite($o, "\xEF\xBB\xBF"); // so Excel reads accents correctly
    fputcsv($o, ['Name', 'Country', 'WhatsApp', 'Work', 'AI level', 'Hours a week', 'Weekly task', 'Question', 'Email', 'Handout', 'Course', 'Free call', 'Updates OK', 'Quiz /5', 'Game points', 'Rating /5', 'Most useful (testimonial)', 'OK to publish', 'Improve', 'Checked in'], ',', '"', '');
    $pts = game_points(load($GAMEF));
    foreach ($d as $r) {
        $row = [$r['name'], $r['country'] ?? '', ($r['phone'] ?? '') !== '' ? 'https://wa.me/' . preg_replace('/\D/', '', $r['phone']) : '', $r['work'], $r['level'], $r['hours'] ?? '', $r['task'], $r['question'], $r['email'],
            $r['wants']['handout'] ? 'yes' : '', $r['wants']['course'] ? 'yes' : '', $r['wants']['call'] ? 'yes' : '', !empty($r['wants']['updates']) ? 'yes' : '', $r['quiz'] ?? '', $pts[$r['id']] ?? 0, $r['fb']['rating'] ?? '', $r['fb']['quote'] ?? '', !empty($r['fb']['publish']) ? 'yes' : '', $r['fb']['improve'] ?? '', $r['first'] ?? $r['at']];
        // Stop spreadsheet formula injection.
        $row = array_map(function ($v) { return preg_match('/^[=+\-@]/', (string)$v) ? "'" . $v : $v; }, $row);
        fputcsv($o, $row, ',', '"', '');
    }
    exit;
}

// ---------------- Live game ----------------
if ($action === 'live') {
    $st = load($DATA . '/state.json');
    $g = load($GAMEF);
    $pid = preg_replace('/[^a-z0-9]/', '', strtolower((string)($_GET['id'] ?? '')));
    $people = load($FILE);
    $player = ($pid !== '' && isset($people[$pid]) && !is_admin()) ? $pid : ''; // the host watches, never plays
    if (($g['phase'] ?? '') === 'open') {
        // Join the race, skip timed-out questions, end the game when everyone is done. Only write when something changes.
        $now = microtime(true);
        $try = $g;
        $a = game_tick($try, $player, $now);
        $c = game_tick_all($try, $now);
        $b = game_autodone($try, $now);
        if ($a || $b || $c) $g = edit($GAMEF, function ($x) use ($player) { $t = microtime(true); game_tick($x, $player, $t); game_tick_all($x, $t); game_autodone($x, $t); return $x; });
    }
    out(['ok' => true, 'step' => (int)($st['step'] ?? 0), 'open' => !empty($st['open']), 'known' => $pid !== '' && isset($people[$pid]), 'game' => game_view($g, $player, $QS, $people, is_admin()), 'now' => microtime(true)]);
}

if ($action === 'answer' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $in = json_decode((string)file_get_contents('php://input'), true) ?: [];
    $pid = preg_replace('/[^a-z0-9]/', '', strtolower((string)($in['id'] ?? '')));
    $q = (int)($in['q'] ?? -1);
    $c = (int)($in['c'] ?? -1);
    $people = load($FILE);
    if (!$pid || !isset($people[$pid])) out(['ok' => false, 'error' => 'Check in first to play.'], 400);
    $res = ['ok' => false, 'error' => 'Time’s up for this one.'];
    $g = edit($GAMEF, function ($g) use ($pid, $q, $c, $QS, $PAUSE, &$res) {
        $now = microtime(true);
        if (($g['phase'] ?? '') !== 'open') { $res['error'] = 'The game is not running.'; return $g; }
        game_tick($g, $pid, $now);
        $p = $g['prog'][$pid];
        if ($p['q'] > $q && isset($g['answers'][$q][$pid]) && (int)$g['answers'][$q][$pid]['c'] >= 0) { $res['error'] = 'You already answered.'; return $g; }
        if ($p['q'] !== $q || !isset($QS[$q]) || $c < 0 || $c >= count($QS[$q]['o']) || $now < $p['at']) return $g;
        if (isset($g['answers'][$q][$pid])) { $res['error'] = 'You already answered.'; return $g; }
        $t = $now - $p['at'];
        $g['answers'][$q][$pid] = ['c' => $c, 't' => round(min($t, qlim($q)), 2)];
        $g['prog'][$pid] = ['q' => $q + 1, 'at' => $now + $PAUSE];
        $res = ['ok' => true];
        return $g;
    });
    out($res + ['game' => game_view($g, $pid, $QS, $people, false)], $res['ok'] ? 200 : 400);
}

if ($action === 'gamectl' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!is_admin()) out(['ok' => false, 'error' => 'Not allowed.'], 403);
    $in = json_decode((string)file_get_contents('php://input'), true) ?: [];
    $op = (string)($in['op'] ?? '');
    edit($GAMEF, function ($g) use ($op) {
        // 3-second countdown so every phone shows question 1 at the same moment.
        if ($op === 'start') { $g = ['phase' => 'open', 'startedAt' => microtime(true) + 3, 'answers' => [], 'prog' => []]; }
        elseif ($op === 'end' && ($g['phase'] ?? '') === 'open') { $g['phase'] = 'done'; $g['endedAt'] = microtime(true); }
        elseif ($op === 'close') { $g['phase'] = 'idle'; }
        return $g;
    });
    out(['ok' => true]);
}

if ($action === 'feedback' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $in = json_decode((string)file_get_contents('php://input'), true) ?: [];
    $pid = preg_replace('/[^a-z0-9]/', '', strtolower((string)($in['id'] ?? '')));
    $rating = (int)($in['rating'] ?? 0);
    if ($rating < 1 || $rating > 5) out(['ok' => false, 'error' => 'Pick a rating from 1 to 5.'], 400);
    $fb = ['rating' => $rating, 'quote' => cut($in['quote'] ?? '', 400), 'improve' => cut($in['improve'] ?? '', 400), 'publish' => !empty($in['publish']), 'at' => date('c')];
    $found = false;
    edit($FILE, function ($d) use ($pid, $fb, &$found) {
        if (isset($d[$pid])) { $d[$pid]['fb'] = $fb; $found = true; }
        return $d;
    });
    out($found ? ['ok' => true] : ['ok' => false, 'error' => 'Check in first (Today tab), then send your feedback.'], $found ? 200 : 400);
}

if ($action === 'quiz' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $in = json_decode((string)file_get_contents('php://input'), true) ?: [];
    $pid = preg_replace('/[^a-z0-9]/', '', strtolower((string)($in['id'] ?? '')));
    $score = max(0, min(5, (int)($in['score'] ?? 0)));
    $found = false;
    edit($FILE, function ($d) use ($pid, $score, &$found) {
        if (isset($d[$pid])) { $d[$pid]['quiz'] = $score; $found = true; }
        return $d;
    });
    out(['ok' => $found]);
}

out(['ok' => false, 'error' => 'Not found.'], 404);
