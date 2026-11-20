<?php
/**
 * Serves a file of the shared interface language packs: /lang/<code>/<name>.js, read from the
 * folder giit-editors-lang next to the sites (src/php/language.php finds it). .htaccess sends
 * those addresses here; the browser's language module (src/js/i18n.js) imports them. The same
 * file in every editor.
 */

declare(strict_types=1);

require __DIR__ . '/php/language.php';

/** A pack file: a language code and a lower-case name. */
const PACK_FILE_PATTERN = '#^[a-z]{2}/[a-z]+\.js$#';
/** How long a browser may keep a pack before it asks again (seconds). */
const PACK_MAX_AGE = 3600;

send_pack_file((string)($_GET['f'] ?? ''));

/**
 * Sends one pack file, or 404 for anything else.
 * @param string $file The pack file relative to the shared folder, e.g. "de/latex.js".
 * @return void
 */
function send_pack_file(string $file): void
{
    $path = get_shared_path($file);
    if (preg_match(PACK_FILE_PATTERN, $file) !== 1 || !has_language_pack(substr($file, 0, 2)) || !is_file($path)) {
        http_response_code(404);
        header('Content-Type: text/plain; charset=utf-8');
        echo "Not found\n";
        return;
    }
    $modified = (int)filemtime($path);
    header('Content-Type: text/javascript; charset=utf-8');
    header('Cache-Control: public, max-age=' . PACK_MAX_AGE);
    header('Last-Modified: ' . gmdate('D, d M Y H:i:s', $modified) . ' GMT');
    $since = $_SERVER['HTTP_IF_MODIFIED_SINCE'] ?? '';
    if ($since !== '' && ($sinceTime = strtotime($since)) !== false && $sinceTime >= $modified) {
        http_response_code(304);
        return;
    }
    header('Content-Length: ' . (string)filesize($path));
    readfile($path);
}
