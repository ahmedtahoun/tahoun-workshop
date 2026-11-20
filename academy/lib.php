<?php
// Shared helpers for the Academy: JSON storage with locks, input cleaning, JSON replies, email through the workshop's Brevo sender.
ini_set('display_errors', '0');
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/../workshop/mail.php'; // m_send(), m_h(), m_wa()

function a_dir() { return getenv('WS_ACADEMY_DIR') ?: __DIR__ . '/data'; }
function a_load($f) { $p = a_dir() . "/$f"; if (!is_file($p)) return []; $d = json_decode((string)file_get_contents($p), true); return is_array($d) ? $d : []; }
function a_edit($f, callable $fn) {
    $h = fopen(a_dir() . "/$f", 'c+'); if (!$h) a_out(['ok' => false, 'error' => 'The server could not save. Tell Ahmed.'], 500);
    flock($h, LOCK_EX); $d = json_decode((string)stream_get_contents($h), true); $d = $fn(is_array($d) ? $d : []);
    ftruncate($h, 0); rewind($h); fwrite($h, json_encode($d, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT)); fflush($h); flock($h, LOCK_UN); fclose($h);
    return $d;
}
function a_out($arr, $code = 200) { http_response_code($code); header('Content-Type: application/json; charset=utf-8'); header('Cache-Control: no-store'); echo json_encode($arr, JSON_UNESCAPED_UNICODE); exit; }
function a_cut($s, $n) { $s = trim(preg_replace('/[\x00-\x1F\x7F]+/u', ' ', (string)$s)); return function_exists('mb_substr') ? mb_substr($s, 0, $n) : substr($s, 0, $n); }
function a_id($s) { return preg_replace('/[^a-z0-9]/', '', strtolower((string)$s)); }
function a_phone($p) { $p = preg_replace('/[^0-9+]/', '', (string)$p); $p = substr($p, 0, 1) === '+' ? '+' . preg_replace('/\D/', '', $p) : preg_replace('/\D/', '', $p); return $p; }
function a_admin() { $k = (string)($_GET['key'] ?? $_POST['key'] ?? ''); return $k !== '' && hash_equals(ADMIN_KEY, $k); }
function a_token($id) { return substr(hash_hmac('sha256', 'academy:' . $id, ADMIN_KEY), 0, 20); }
function a_rate($limit = 40) { // per network, per hour
    $now = time(); $ip = hash('sha256', $_SERVER['REMOTE_ADDR'] ?? ''); $blocked = false;
    a_edit('rate.json', function ($r) use ($ip, $now, $limit, &$blocked) {
        foreach ($r as $k => $t) { $r[$k] = array_values(array_filter($t, function ($x) use ($now) { return $x > $now - 3600; })); if (!$r[$k]) unset($r[$k]); }
        if (count($r[$ip] ?? []) >= $limit) { $blocked = true; return $r; } $r[$ip][] = $now; return $r;
    });
    if ($blocked) a_out(['ok' => false, 'error' => 'Too many tries from this network. Wait a few minutes.'], 429);
}

// ---- Emails (same design as the workshop emails) ----
// $c: layout fields for m_layout(): title, pre, body, cta, after, why, unsub. label defaults to "Academy".
function a_mail($to, $name, $subject, $c) {
    if (BREVO_API_KEY === '' || $to === '') return false;
    $c += ['label' => 'Academy', 'why' => 'You get this because you signed up at Tahoun AI Academy.', 'unsub' => ''];
    try { $r = m_send($to, $name, $subject, m_layout($c), m_text($c)); return $r['ok']; } catch (Throwable $e) { return false; }
}
function a_unsub($id) { return ACADEMY_URL . 'unsub.php?u=' . $id . '&t=' . a_token($id); }
