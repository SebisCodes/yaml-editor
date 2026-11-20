<?php
/**
 * Serves a legal page (imprint, privacy policy, terms; German and English) as it is and counts
 * the view for the usage statistics (src/php/metrics.php). .htaccess sends those addresses
 * here. The same file in every editor and in the overview.
 */

declare(strict_types=1);

require __DIR__ . '/php/page.php';

/** The legal pages; only these names are served. */
const LEGAL_PAGE_PATTERN = '#^(?:impressum|imprint|datenschutz|privacy|agb|terms)\.html$#';

send_legal_page((string)($_GET['f'] ?? ''));

/**
 * Sends one legal page and counts its view, or answers 404 for any other name.
 * @param string $file The file name, e.g. "privacy.html".
 * @return void
 */
function send_legal_page(string $file): void
{
    $path = __DIR__ . '/' . $file;
    if (preg_match(LEGAL_PAGE_PATTERN, $file) !== 1 || !is_file($path)) {
        http_response_code(404);
        header('Content-Type: text/plain; charset=utf-8');
        echo "Not found\n";
        return;
    }
    send_page((string)file_get_contents($path), (int)filemtime($path));
    add_page_view($file, ROOT_LANGUAGE);
}
