<?php
require __DIR__ . '/includes/bootstrap.php';
require __DIR__ . '/includes/days.php';

// Sert un message vocal uniquement aux personnes qui ont accès au groupe.
// Gère les demandes par morceaux (Range) : Safari sur iPhone en a besoin pour lire un son.
$user = require_login();
day_audio_ensure();
$stmt = db()->prepare('SELECT p.day_id, a.path, a.mime FROM day_post_audio a JOIN day_posts p ON p.id = a.post_id WHERE a.post_id = ?');
$stmt->execute([(int)opt($_GET, 'id', 0)]);
$a = $stmt->fetch();
if (!$a || !day_access((int)$user['id'], $a['day_id'])) {
    http_response_code(404);
    exit;
}
$file = storage_dir('audio') . '/' . basename($a['path']);
$types = array('audio/webm', 'audio/ogg', 'audio/mp4');
if (!is_file($file) || !in_array($a['mime'], $types, true)) {
    http_response_code(404);
    exit;
}
session_write_close();

$size = filesize($file);
$start = 0;
$end = $size - 1;
header('Accept-Ranges: bytes');
if (isset($_SERVER['HTTP_RANGE']) && preg_match('/^bytes=(\d*)-(\d*)$/', trim((string)$_SERVER['HTTP_RANGE']), $m) && ($m[1] !== '' || $m[2] !== '')) {
    if ($m[1] === '') {
        $start = max(0, $size - (int)$m[2]);
    } else {
        $start = (int)$m[1];
        if ($m[2] !== '') {
            $end = min($end, (int)$m[2]);
        }
    }
    if ($start > $end || $start >= $size) {
        http_response_code(416);
        header('Content-Range: bytes */' . $size);
        exit;
    }
    http_response_code(206);
    header('Content-Range: bytes ' . $start . '-' . $end . '/' . $size);
}
header('Content-Type: ' . $a['mime']);
header('Content-Length: ' . ($end - $start + 1));
header('X-Content-Type-Options: nosniff');
header('Cache-Control: private, max-age=86400');

$fp = fopen($file, 'rb');
if ($fp === false) {
    exit;
}
fseek($fp, $start);
$left = $end - $start + 1;
while ($left > 0 && !feof($fp)) {
    $chunk = fread($fp, (int)min(65536, $left));
    if ($chunk === false || $chunk === '') {
        break;
    }
    echo $chunk;
    $left -= strlen($chunk);
}
fclose($fp);
