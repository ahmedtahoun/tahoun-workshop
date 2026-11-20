<?php
// Course reminders for people who started the free course but haven't finished it.
// Runs from workshop/cron.php every 15 minutes: one email after 1 day, a last one after 4 days, then never again.
require_once __DIR__ . '/lib.php';

function a_nudges($limit = 30) {
    $now = m_now(); $sent = 0;
    $learners = a_load('learners.json');
    $titles = ['what-ai-is' => 'What AI really is', 'the-brief' => 'The brief', 'thinking-partner' => 'Assistant & thinking partner', 'upgrade' => 'Upgrade your business', 'safety' => 'Using it safely'];
    foreach ($learners as $id => $r) {
        if ($sent >= $limit) break;
        if (empty($r['email']) || !empty($r['unsub']) || !empty($r['cert'])) continue;
        $age = $now - strtotime($r['joined']);
        $which = null;
        if ($age >= 96 * 3600 && empty($r['nudge2'])) $which = 'nudge2';
        elseif ($age >= 24 * 3600 && empty($r['nudge1'])) $which = 'nudge1';
        if (!$which) continue;
        $done = count($r['done'] ?? []);
        $next = null; foreach ($titles as $k => $t) if (empty($r['done'][$k])) { $next = $t; break; }
        $resume = ACADEMY_URL . 'course.html?u=' . $id . '&t=' . a_token($id);
        $c = $which === 'nudge1'
            ? ['title' => $done ? "You're $done/5 of the way there" : 'Your first lesson takes 8 minutes', 'pre' => 'Pick up where you left off: ' . ($next ?: 'the final quiz') . '.',
               'body' => m_p('Hi ' . m_h($r['name']) . ', quick nudge: ' . ($next ? 'your next lesson is <b>' . m_h($next) . '</b>.' : 'only the final quiz is left.')) . m_p('Each lesson takes about 8 minutes, and your progress is saved.'),
               'cta' => [$resume, $done ? 'Continue the course' : 'Start lesson 1']]
            : ['title' => 'One last nudge, then I’ll leave you be', 'pre' => 'Finish Brief Your AI and get your certificate of completion.',
               'body' => m_p('Hi ' . m_h($r['name']) . ', this is the last reminder from me. ' . ($done ? "You’ve done $done of 5 lessons; " : '') . 'finish the course and the short quiz, and you get a certificate of completion you can add to LinkedIn.')
                   . m_p('If something got in the way, or a lesson wasn’t clear, just reply and tell me. It helps me make it better.'),
               'cta' => [$resume, 'Finish the course']];
        $c['unsub'] = a_unsub($id);
        if (a_mail($r['email'], $r['name'], $c['title'], $c)) {
            $sent++;
            a_edit('learners.json', function ($d) use ($id, $which, $now) { if (isset($d[$id])) { $d[$id][$which] = date('c', $now); if ($which === 'nudge2') $d[$id]['nudge1'] = $d[$id]['nudge1'] ?? date('c', $now); } return $d; });
        }
    }
    return $sent;
}
