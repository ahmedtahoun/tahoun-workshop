<?php
// Copy this file to config.php on the server and fill in the values. config.php is never committed or deployed.
// Private key for admin.php and the wall controls. Change it if you like.
define('ADMIN_KEY', '');

// ---- Email (Brevo) ----
// Paste your Brevo API key here (Brevo → SMTP & API → API keys). Until it's set, emails wait in the queue.
define('BREVO_API_KEY', '');
define('MAIL_FROM', '');
define('MAIL_FROM_NAME', '');

// The workshop: the app's public address and the event date (follow-ups are timed from it, Cairo time).
define('SITE_URL', '');
define('EVENT_DATE', '');
define('EVENT_NAME', '');
define('CONTACT_WHATSAPP', '');
define('CONTACT_LINKEDIN', '');
define('CONTACT_WEBSITE', '');
