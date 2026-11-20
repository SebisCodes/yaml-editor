<?php
/**
 * Router for PHP's built-in server on a development machine; it does what .htaccess does on
 * the web server: language folders to the pages, /lang/ to the shared packs, everything else
 * as it is. Start it from the folder of the site (an editor, or docs/index for the overview):
 *
 *     php -S 127.0.0.1:<port> -t src src/php/router.php
 *
 * The same file in every editor and in the overview.
 */

declare(strict_types=1);

/** The language folders of the page addresses. */
const ROUTER_LANGUAGE_FOLDER = '#^/(de|fr|it|es|pt|nl|pl|tr|ru|uk|zh|ja|ko)/(embed/)?$#';
/** A legal page; its views are counted like those of the other pages. */
const ROUTER_LEGAL_PAGE = '#^/((?:impressum|imprint|datenschutz|privacy|agb|terms)\.html)$#';
/** An interface pack of the shared folder. */
const ROUTER_PACK_ADDRESS = '#^/lang/([a-z]{2}/[a-z]+\.js)$#';

$routerPath = (string)parse_url((string)($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
return handle_request($routerPath);

/**
 * Runs the script of a request path, or lets the built-in server send the file.
 * @param string $path The request path.
 * @return bool false when the built-in server is to send the file itself, true when a script ran.
 */
function handle_request(string $path): bool
{
    $root = dirname(__DIR__);
    if (preg_match(ROUTER_LANGUAGE_FOLDER, $path, $match) === 1) {
        $_GET['lang'] = $match[1];
        require $root . '/' . ($match[2] ?? '') . 'index.php';
        return true;
    }
    if (preg_match(ROUTER_LEGAL_PAGE, $path, $match) === 1) {
        $_GET['f'] = $match[1];
        require $root . '/legal.php';
        return true;
    }
    if (preg_match(ROUTER_PACK_ADDRESS, $path, $match) === 1) {
        $_GET['f'] = $match[1];
        require $root . '/lang.php';
        return true;
    }
    if (preg_match('#^/(php|templates)(/|$)#', $path) === 1) {
        http_response_code(404);
        return true;
    }
    if ($path === '/embed/') {
        require $root . '/embed/index.php';
        return true;
    }
    return false;
}
