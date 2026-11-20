# Brief Your AI · workshop app and Tahoun AI Academy

Live at https://tahoun.wheretospot.com/workshop/ and https://tahoun.wheretospot.com/academy/

- `workshop/`: phone app for the free Dahab workshop (check-in, slides, live game, quiz, certificate), the room wall, admin page and follow-up emails via Brevo.
- `academy/`: the free online course, the learning games (`play.js`) and the certificate check.

Plain PHP + vanilla JS, data in JSON files under `*/data/` (blocked by `.htaccess`).

## Setup
Copy `workshop/config.example.php` to `workshop/config.php` on the server and fill it in. It holds the admin key and the Brevo key and is never committed.

## Deploy
Every push to `main` uploads the changed files to cPanel over FTPS (`.github/workflows/deploy.yml`). `config.php` and the data files are never uploaded.
