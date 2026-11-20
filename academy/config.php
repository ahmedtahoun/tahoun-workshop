<?php
// The Academy shares the workshop's settings (admin key, Brevo key, sender, contacts) so secrets live in one place.
require_once __DIR__ . '/../workshop/config.php';
define('ACADEMY_URL', 'https://tahoun.wheretospot.com/academy/');
define('ACADEMY_NAME', 'Tahoun AI Academy');
define('CERT_PASS', 4); // final quiz: at least 4 of 5 for the certificate
