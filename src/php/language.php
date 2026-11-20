<?php
/**
 * The language of a page request and the shared language packs. A page in another language
 * than English has its own address: /de/ for the editor, /de/embed/ for the developer page
 * (.htaccess passes the folder as ?lang=); a page inside another page may also name it with
 * ?lang=de. A person who opens a page without a language is led to the language they picked
 * before (the cookie lang, shared by every giit.ch site) or to the first language of their
 * browser that the site has. A pick from the language menu (?setlang=<code>) is kept in that
 * cookie. The packs lie in the folder giit-editors-lang next to the sites (or next to the
 * repositories on a development machine). Used by src/php/page.php; the same file in every
 * editor and in the overview.
 *
 * select_page_language() runs these steps:
 *   1. Mark the pages as depending on Accept-Language and Cookie (Vary).
 *   2. Leave every request alone that is not a person opening a page at the top level: other
 *      methods than GET and HEAD, crawlers, frames, and addresses with embed or viewer.
 *   3. A pick (?setlang=<code>): store a known language in the cookie, then lead (302) to the
 *      address of the page in that language, without setlang.
 *   4. Without a language in the address: lead (302) to the picked language, else to the first
 *      language of Accept-Language that the site has; English stays as it is.
 *
 * The addresses of the redirects are built from the page, never from the address the client
 * sent, so no redirect leads to another host.
 */

declare(strict_types=1);

/** The languages in the order of the language menus and of the hreflang links. */
const PAGE_LANGUAGES = ['en', 'de', 'fr', 'it', 'es', 'pt', 'nl', 'pl', 'tr', 'ru', 'uk', 'zh', 'ja', 'ko'];
/** The language of the root addresses (no language folder). */
const ROOT_LANGUAGE = 'en';
/** The folder of the shared language packs, searched in the folders above this file. */
const SHARED_FOLDER_NAME = 'giit-editors-lang';
/** The file every pack folder holds; it marks the shared folder. */
const SHARED_MARKER_FILE = 'editors.json';
/** How many folders up the shared folder is searched. */
const SHARED_FOLDER_DEPTH = 6;
/** The parameter that names the language of a page. */
const LANGUAGE_PARAMETER = 'lang';
/** The parameter of a pick from the language menu. */
const PICK_PARAMETER = 'setlang';
const NEGOTIATION_VARY = 'Vary: Accept-Language, Cookie';
/** Parameters of a page inside another page: such a page keeps the language of its address. */
const EMBEDDING_PARAMETERS = ['embed', 'viewer'];
const LANGUAGE_COOKIE = 'lang';
const LANGUAGE_COOKIE_MAX_AGE = 31536000;
const LANGUAGE_COOKIE_DOMAIN = 'giit.ch';
const REDIRECTED_METHODS = ['GET', 'HEAD'];
const CRAWLER_PATTERN = '/bot|crawl|spider|slurp|preview/i';
const FRAME_DESTINATIONS = ['iframe', 'frame', 'embed', 'object'];
const MAX_ACCEPTED_LANGUAGES = 32;
const ACCEPTED_LANGUAGE_PATTERN = '/^\s*([a-z]{1,8}(?:-[a-z0-9]{1,8})*|\*)\s*(?:;\s*q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)\s*)?$/i';
const REDIRECT_STATUS = 302;

/**
 * Keeps a pick from the language menu, or leads a person to their language; returns when the
 * page is to be served at this address.
 * @param string $path The address path of the page below the site's root ("" or "embed/").
 * @return void
 */
function select_page_language(string $path): void
{
    header(NEGOTIATION_VARY);
    if (!is_person_at_top_level()) {
        return;
    }
    $query = get_request_query();
    if (has_query_parameter($query, PICK_PARAMETER)) {
        $picked = get_query_value($query, PICK_PARAMETER);
        save_language_pick($picked);
        $rest = get_query_without_parameter(get_query_without_parameter($query, PICK_PARAMETER), LANGUAGE_PARAMETER);
        send_redirect(get_language_path(has_language_pack($picked) ? $picked : ROOT_LANGUAGE, $path), $rest);
    }
    if (get_page_language() !== ROOT_LANGUAGE || has_query_parameter($query, LANGUAGE_PARAMETER)) {
        return;
    }
    $language = get_visitor_language();
    if ($language !== ROOT_LANGUAGE) {
        send_redirect(get_language_path($language, $path), $query);
    }
}

/**
 * Returns the language a page is served in: the language of its folder or of ?lang= when the
 * site has it, else English.
 * @return string A language code of PAGE_LANGUAGES.
 */
function get_page_language(): string
{
    $asked = strtolower((string)($_GET[LANGUAGE_PARAMETER] ?? ''));
    return has_language_pack($asked) ? $asked : ROOT_LANGUAGE;
}

/**
 * Returns the address path of a page in a language.
 * @param string $language The language code.
 * @param string $path The address path of the page below the site's root ("" or "embed/").
 * @return string "/" or "/embed/" for English, "/de/" or "/de/embed/" for the others.
 */
function get_language_path(string $language, string $path): string
{
    return '/' . ($language === ROOT_LANGUAGE ? '' : $language . '/') . $path;
}

/**
 * Returns the languages a site has: English and every language whose pack holds the site.
 * @param string $site The site key.
 * @return string[] Language codes in the order of PAGE_LANGUAGES.
 */
function get_site_languages(string $site): array
{
    return array_values(array_filter(PAGE_LANGUAGES, fn(string $language): bool => is_file(get_shared_path($language . '/' . $site . '.json'))));
}

/**
 * Tells whether the shared packs have a language.
 * @param string $language The language code.
 * @return bool true for a language of PAGE_LANGUAGES with a pack folder.
 */
function has_language_pack(string $language): bool
{
    return in_array($language, PAGE_LANGUAGES, true) && is_file(get_shared_path($language . '/common.json'));
}

/**
 * Returns the path of a file in the shared language folder.
 * @param string $file The file relative to the shared folder, e.g. "de/common.json".
 * @return string The full path; under a folder that does not exist when the shared folder is missing.
 */
function get_shared_path(string $file): string
{
    return find_shared_folder() . '/' . $file;
}

/**
 * Finds the shared language folder in the folders above this file, once per request.
 * @return string The folder, or the name alone when it is not found.
 */
function find_shared_folder(): string
{
    static $folder = null;
    if ($folder !== null) {
        return $folder;
    }
    $folder = SHARED_FOLDER_NAME;
    $parent = __DIR__;
    for ($level = 0; $level < SHARED_FOLDER_DEPTH; $level++) {
        $parent = dirname($parent);
        $candidate = $parent . '/' . SHARED_FOLDER_NAME;
        if (is_file($candidate . '/' . SHARED_MARKER_FILE)) {
            $folder = $candidate;
            break;
        }
    }
    return $folder;
}

/**
 * Reads a JSON file of the shared language folder.
 * @param string $file The file relative to the shared folder.
 * @return array<mixed> Its content, empty when it is missing or not JSON.
 */
function read_shared_json(string $file): array
{
    $path = get_shared_path($file);
    if (!is_file($path)) {
        return [];
    }
    $data = json_decode((string)file_get_contents($path), true);
    return is_array($data) ? $data : [];
}

/**
 * Tells whether the request is a person opening a page at the top level.
 * @return bool true for GET or HEAD by a browser, not in a frame, without embed or viewer.
 */
function is_person_at_top_level(): bool
{
    $method = (string)($_SERVER['REQUEST_METHOD'] ?? '');
    $agent = (string)($_SERVER['HTTP_USER_AGENT'] ?? '');
    $destination = strtolower((string)($_SERVER['HTTP_SEC_FETCH_DEST'] ?? ''));
    $query = get_request_query();
    foreach (EMBEDDING_PARAMETERS as $parameter) {
        if (has_query_parameter($query, $parameter)) {
            return false;
        }
    }
    return in_array($method, REDIRECTED_METHODS, true) && preg_match(CRAWLER_PATTERN, $agent) !== 1
        && !in_array($destination, FRAME_DESTINATIONS, true);
}

/**
 * Returns the query string the client sent; the rewrite in .htaccess keeps it out of $_GET.
 * @return string The query without "?", empty when there is none.
 */
function get_request_query(): string
{
    $target = (string)($_SERVER['REQUEST_URI'] ?? '');
    $start = strpos($target, '?');
    return $start === false ? '' : substr($target, $start + 1);
}

/**
 * Splits a query string into its parameters.
 * @param string $query The query without "?".
 * @return string[] The non-empty "name=value" parts, still encoded.
 */
function get_query_parts(string $query): array
{
    return array_values(array_filter(explode('&', $query), fn(string $part): bool => $part !== ''));
}

/**
 * Returns the decoded name of one query parameter.
 * @param string $part One "name=value" part.
 * @return string The name.
 */
function get_query_part_name(string $part): string
{
    return urldecode(explode('=', $part, 2)[0]);
}

/**
 * Tells whether a query has a parameter.
 * @param string $query The query without "?".
 * @param string $name The parameter name.
 * @return bool true when the parameter is there, with or without a value.
 */
function has_query_parameter(string $query, string $name): bool
{
    foreach (get_query_parts($query) as $part) {
        if (get_query_part_name($part) === $name) {
            return true;
        }
    }
    return false;
}

/**
 * Returns the decoded value of the first occurrence of a query parameter.
 * @param string $query The query without "?".
 * @param string $name The parameter name.
 * @return string The value, empty when the parameter is missing or has none.
 */
function get_query_value(string $query, string $name): string
{
    foreach (get_query_parts($query) as $part) {
        if (get_query_part_name($part) === $name) {
            return urldecode(explode('=', $part, 2)[1] ?? '');
        }
    }
    return '';
}

/**
 * Returns a query without every occurrence of one parameter.
 * @param string $query The query without "?".
 * @param string $name The parameter to drop.
 * @return string The query without "?", the other parts unchanged.
 */
function get_query_without_parameter(string $query, string $name): string
{
    $kept = array_filter(get_query_parts($query), fn(string $part): bool => get_query_part_name($part) !== $name);
    return implode('&', $kept);
}

/**
 * Returns the language of a visitor: the picked one, else the best one of Accept-Language.
 * @return string A language code the editor has.
 */
function get_visitor_language(): string
{
    $picked = get_picked_language();
    if ($picked !== '' && has_language_pack($picked)) {
        return $picked;
    }
    return get_accepted_language((string)($_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? ''));
}

/**
 * Returns the language kept in the cookie lang.
 * @return string The language code, empty without a cookie or with an unknown value.
 */
function get_picked_language(): string
{
    foreach (explode(';', (string)($_SERVER['HTTP_COOKIE'] ?? '')) as $cookie) {
        $nameAndValue = explode('=', $cookie, 2);
        if (count($nameAndValue) === 2 && trim($nameAndValue[0]) === LANGUAGE_COOKIE
            && in_array(trim($nameAndValue[1]), PAGE_LANGUAGES, true)) {
            return trim($nameAndValue[1]);
        }
    }
    return '';
}

/**
 * Returns the language of Accept-Language with the highest weight that the editor has.
 * @param string $header The Accept-Language header.
 * @return string The language code, English when none fits.
 */
function get_accepted_language(string $header): string
{
    $best = ROOT_LANGUAGE;
    $bestWeight = 0.0;
    foreach (array_slice(explode(',', $header), 0, MAX_ACCEPTED_LANGUAGES) as $entry) {
        if (preg_match(ACCEPTED_LANGUAGE_PATTERN, $entry, $match) !== 1) {
            continue;
        }
        $language = $match[1] === '*' ? ROOT_LANGUAGE : strtolower(explode('-', $match[1])[0]);
        $weight = isset($match[2]) ? (float)$match[2] : 1.0;
        if ($weight > $bestWeight && has_language_pack($language)) {
            $best = $language;
            $bestWeight = $weight;
        }
    }
    return $best;
}

/**
 * Keeps a picked language in the cookie lang, for every giit.ch site on giit.ch hosts.
 * @param string $language The picked language code; an unknown one is not kept.
 * @return void
 */
function save_language_pick(string $language): void
{
    if (!has_language_pack($language)) {
        return;
    }
    $cookie = LANGUAGE_COOKIE . '=' . $language . '; Path=/; Max-Age=' . LANGUAGE_COOKIE_MAX_AGE . '; SameSite=Lax';
    if (is_giit_host()) {
        $cookie .= '; Secure; Domain=' . LANGUAGE_COOKIE_DOMAIN;
    } elseif (is_https_request()) {
        $cookie .= '; Secure';
    }
    header('Set-Cookie: ' . $cookie, false);
}

/**
 * Tells whether the request is for giit.ch or one of its subdomains.
 * @return bool true on a giit.ch host.
 */
function is_giit_host(): bool
{
    $host = strtolower(preg_replace('/:\d+$/', '', (string)($_SERVER['HTTP_HOST'] ?? '')) ?? '');
    return $host === LANGUAGE_COOKIE_DOMAIN || str_ends_with($host, '.' . LANGUAGE_COOKIE_DOMAIN);
}

/**
 * Tells whether the request came over HTTPS.
 * @return bool true for HTTPS, also behind a proxy that says so.
 */
function is_https_request(): bool
{
    $https = strtolower((string)($_SERVER['HTTPS'] ?? ''));
    return ($https !== '' && $https !== 'off') || strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
}

/**
 * Ends the request with a redirect that no cache keeps.
 * @param string $path The address path on this host.
 * @param string $query The query without "?", may be empty.
 * @return never
 */
function send_redirect(string $path, string $query): never
{
    header('Cache-Control: no-store');
    header('Location: ' . $path . ($query === '' ? '' : '?' . $query), true, REDIRECT_STATUS);
    exit;
}
