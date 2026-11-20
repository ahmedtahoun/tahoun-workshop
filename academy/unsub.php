<?php
require __DIR__ . '/lib.php';
$id = a_id($_GET['u'] ?? ''); $ok = $id !== '' && hash_equals(a_token($id), (string)($_GET['t'] ?? ''));
if ($ok) a_edit('learners.json', function ($d) use ($id) { if (isset($d[$id])) $d[$id]['unsub'] = true; return $d; });
?><!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Emails · Tahoun AI Academy</title><link rel="stylesheet" href="academy.css"></head>
<body><main class="wrap narrow" style="padding-block:80px"><h1 style="font-size:40px"><?= $ok ? 'You’re unsubscribed' : 'Link not recognised' ?></h1>
<p class="lead" style="margin-top:12px"><?= $ok ? 'You won’t get more Academy emails. Your course and certificate still work.' : 'Message Ahmed on WhatsApp and he’ll remove you.' ?></p>
<p style="margin-top:20px"><a class="btn alt" href="<?= m_h(m_wa()) ?>">WhatsApp</a></p></main></body></html>
