<?php
/**
 * Serves a page of a giit site in the language of the request: a PHP template (src/templates/)
 * with the texts of the shared language packs (giit-editors-lang/<code>/*.json). The templates
 * hold markup and keys only; get_text('key') puts in the text of the page's language. The same file
 * in every editor and in the overview.
 *
 * Usage, in src/index.php (src/php/site.php names the site):
 *
 *     require __DIR__ . '/php/site.php';
 *     require __DIR__ . '/php/page.php';
 *     send_site_page(SITE_KEY, 'editor');
 *
 * send_site_page() runs these steps:
 *   1. Find the language (src/php/language.php): a pick from the language menu or a visitor
 *      without a language in the address ends here with a redirect.
 *   2. Read the language pack of the site and the pack shared by every page.
 *   3. Render the template of the page with them.
 *   4. Send the page, or 304 when the browser's copy is current.
 *   5. Count the view for the usage statistics (src/php/metrics.php).
 */

declare(strict_types=1);

require_once __DIR__ . '/language.php';

/** The templates of the pages, relative to this folder. */
const TEMPLATE_FOLDER = __DIR__ . '/../templates';
/** The usage statistics, relative to this folder. */
const METRICS_SCRIPT = __DIR__ . '/metrics.php';
/** The function of the usage statistics that counts a page view. */
const METRICS_VIEW_FUNCTION = 'add_metrics_view';
/** The Open Graph locale of each language. */
const PAGE_LOCALES = ['en' => 'en_US', 'de' => 'de_CH', 'fr' => 'fr_FR', 'it' => 'it_IT', 'es' => 'es_ES', 'pt' => 'pt_BR',
    'nl' => 'nl_NL', 'pl' => 'pl_PL', 'tr' => 'tr_TR', 'ru' => 'ru_RU', 'uk' => 'uk_UA', 'zh' => 'zh_CN', 'ja' => 'ja_JP', 'ko' => 'ko_KR'];
/** The name of each language in itself, as the language menus show it. */
const LANGUAGE_NAMES = ['en' => 'English', 'de' => 'Deutsch', 'fr' => 'Français', 'it' => 'Italiano', 'es' => 'Español',
    'pt' => 'Português', 'nl' => 'Nederlands', 'pl' => 'Polski', 'tr' => 'Türkçe', 'ru' => 'Русский', 'uk' => 'Українська',
    'zh' => '中文（简体）', 'ja' => '日本語', 'ko' => '한국어'];
/** The attributes of a link that opens in a new tab (GitHub links). */
const NEW_TAB_ATTRIBUTES = ' target="_blank" rel="noopener"';
/** The class on <html> while the editor's interface waits for its translation in the browser. */
const TRANSLATING_CLASS = 'translate';

/**
 * The page being served: site key, page name, language, packs and addresses.
 * @var array<string,mixed>
 */
$GLOBALS['giitPage'] = [];

/**
 * Serves one page of the site in the language of the request.
 * @param string $site The key of the site in editors.json, e.g. "latex", or "overview".
 * @param string $page The page: "editor", "embed" or "overview"; its template is src/templates/<page>.php.
 * @return void
 */
function send_site_page(string $site, string $page): void
{
    $path = get_page_path($page);
    select_page_language($path);
    $language = get_page_language();
    $html = build_site_page($site, $page, $language);
    send_page($html, get_newest_source_time($page, $site, $language));
    add_page_view($path, $language);
}

/**
 * Builds one page of the site in a language, without sending it (src/post.php adds a
 * document to the editor page).
 * @param string $site The key of the site in editors.json.
 * @param string $page The page: "editor", "embed" or "overview".
 * @param string $language The language code.
 * @return string The HTML of the page.
 */
function build_site_page(string $site, string $page, string $language): string
{
    $GLOBALS['giitPage'] = create_page_context($site, $page, get_page_path($page), $language);
    return render_template($page);
}

/**
 * Returns the address path of a page below the site's root.
 * @param string $page The page name.
 * @return string "embed/" for the developer page, empty for the others.
 */
function get_page_path(string $page): string
{
    return $page === 'embed' ? 'embed/' : '';
}

/**
 * Creates the context of the page: what the templates and the helpers read.
 * @param string $site The site key.
 * @param string $page The page name.
 * @param string $path The address path of the page below the site's root.
 * @param string $language The language code.
 * @return array<string,mixed> The context.
 */
function create_page_context(string $site, string $page, string $path, string $language): array
{
    $editors = read_shared_json('editors.json');
    $siteUrl = (string)(find_site($editors, $site)['url'] ?? '/');
    return [
        'site' => $site,
        'page' => $page,
        'path' => $path,
        'language' => $language,
        'siteUrl' => $siteUrl,
        'editors' => $editors,
        'texts' => read_page_texts($language, $site),
        'fallback' => $language === ROOT_LANGUAGE ? [] : read_page_texts(ROOT_LANGUAGE, $site),
    ];
}

/**
 * Finds a site in the list of editors.json.
 * @param array<string,mixed> $editors The content of editors.json.
 * @param string $site The site key.
 * @return array<string,mixed> The entry, empty when the key is unknown.
 */
function find_site(array $editors, string $site): array
{
    if ($site === 'overview') {
        return (array)($editors['overview'] ?? []);
    }
    foreach ((array)($editors['editors'] ?? []) as $editor) {
        if (($editor['key'] ?? '') === $site) {
            return (array)$editor;
        }
    }
    return [];
}

/**
 * Reads the texts of a page in a language: the site's pack over the pack every page shares.
 * @param string $language The language code.
 * @param string $site The site key; its pack is <code>/<site>.json.
 * @return array<string,mixed> The texts by key.
 */
function read_page_texts(string $language, string $site): array
{
    return array_replace(read_shared_json($language . '/common.json'), read_shared_json($language . '/' . $site . '.json'));
}

/**
 * Renders the template of a page with the context set.
 * @param string $page The page name.
 * @return string The HTML of the page.
 */
function render_template(string $page): string
{
    ob_start();
    include TEMPLATE_FOLDER . '/' . $page . '.php';
    return (string)ob_get_clean();
}

/**
 * Returns the time of the newest file the page is made of.
 * @param string $page The page name.
 * @param string $site The site key.
 * @param string $language The language code.
 * @return int The modification time.
 */
function get_newest_source_time(string $page, string $site, string $language): int
{
    $files = [TEMPLATE_FOLDER . '/' . $page . '.php', TEMPLATE_FOLDER . '/footer.php', __FILE__,
        get_shared_path($language . '/common.json'), get_shared_path($language . '/' . $site . '.json'), get_shared_path('editors.json')];
    $times = array_map(fn(string $file): int => is_file($file) ? (int)filemtime($file) : 0, $files);
    return max($times);
}

/**
 * Sends a page with its Last-Modified date and ETag, or 304 when the browser's copy is current.
 * @param string $html The page.
 * @param int $modified The time of the page's newest source file.
 * @return void
 */
function send_page(string $html, int $modified): void
{
    $etag = '"' . hash('sha256', $html) . '"';
    header('Content-Type: text/html; charset=utf-8');
    header('Last-Modified: ' . gmdate('D, d M Y H:i:s', $modified) . ' GMT');
    header('ETag: ' . $etag);
    if (trim((string)($_SERVER['HTTP_IF_NONE_MATCH'] ?? '')) === $etag) {
        http_response_code(304);
        return;
    }
    header('Content-Length: ' . (string)strlen($html));
    echo $html;
}

/**
 * Counts the view for the usage statistics when they are there, under the address of the
 * page: /, /de/, /embed/, /de/embed/.
 * @param string $path The address path of the page below the site's root.
 * @param string $language The language code.
 * @return void
 */
function add_page_view(string $path, string $language): void
{
    if (!is_readable(METRICS_SCRIPT)) {
        return;
    }
    require_once METRICS_SCRIPT;
    if (function_exists(METRICS_VIEW_FUNCTION)) {
        add_metrics_view(get_language_path($language, $path));
    }
}

/* ---------- Helpers for the templates ---------- */

/**
 * Returns a text of the page's language, escaped for HTML; the English text when the language
 * lacks it.
 * @param string $key The key, dotted for a nested text ("embed.h1").
 * @param array<string,string> $values Values for {name} placeholders in the text.
 * @return string The escaped text.
 */
function get_text(string $key, array $values = []): string
{
    return escape_html(apply_placeholders(get_raw_text($key), $values));
}

/**
 * Returns a text of the page's language that holds markup, as it is.
 * @param string $key The key, dotted for a nested text.
 * @param array<string,string> $values Values for {name} placeholders, inserted as they are.
 * @return string The HTML.
 */
function get_html(string $key, array $values = []): string
{
    return apply_placeholders(get_raw_text($key), $values);
}

/**
 * Returns a list or object of the page's language (FAQ entries, steps …).
 * @param string $key The key, dotted for a nested value.
 * @return array<mixed> The value, empty when it is missing.
 */
function get_list(string $key): array
{
    $value = get_value($key);
    return is_array($value) ? $value : [];
}

/**
 * Returns JSON-LD data of the page's language, safe inside a <script> element.
 * @param string $key The key of the data.
 * @return string The JSON with "</" written as "<\/".
 */
function get_json_ld(string $key): string
{
    return str_replace('</', '<\/', (string)json_encode(get_list($key), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
}

/**
 * Returns the language of the page being built.
 * @return string The language code, e.g. "de".
 */
function get_template_language(): string
{
    return (string)$GLOBALS['giitPage']['language'];
}

/**
 * Returns the Open Graph locale of the page.
 * @return string The locale, e.g. "de_CH".
 */
function get_page_locale(): string
{
    return PAGE_LOCALES[get_template_language()] ?? get_template_language();
}

/**
 * Returns the attributes of <html>: its language, and on the editor page in another language
 * than English the class that hides the interface until the browser has translated it.
 * @return string The attributes, e.g. lang="de" class="translate".
 */
function build_html_attributes(): string
{
    $page = (string)$GLOBALS['giitPage']['page'];
    $class = $page === 'editor' && get_template_language() !== ROOT_LANGUAGE ? ' class="' . TRANSLATING_CLASS . '"' : '';
    return 'lang="' . get_template_language() . '"' . $class;
}

/**
 * Returns the public address of this page in a language.
 * @param string|null $language The language code, null for the page's own.
 * @return string The address, e.g. https://latex.giit.ch/de/embed/.
 */
function get_page_url(?string $language = null): string
{
    $context = $GLOBALS['giitPage'];
    return rtrim((string)$context['siteUrl'], '/') . get_language_path($language ?? get_template_language(), (string)$context['path']);
}

/**
 * Returns the address of another site's page in the page's language.
 * @param string $url The English address of the site, ending in "/".
 * @return string The address in the language; the language folder for another language.
 */
function get_site_url(string $url): string
{
    return rtrim($url, '/') . get_language_path(get_template_language(), '');
}

/**
 * Returns the hreflang links of the page: one per language the site has, and x-default.
 * @return string The <link rel="alternate"> lines.
 */
function build_hreflang_links(): string
{
    $links = [];
    foreach (get_site_languages((string)$GLOBALS['giitPage']['site']) as $language) {
        $links[] = '<link rel="alternate" hreflang="' . $language . '" href="' . escape_html(get_page_url($language)) . '">';
    }
    $links[] = '<link rel="alternate" hreflang="x-default" href="' . escape_html(get_page_url(ROOT_LANGUAGE)) . '">';
    return implode("\n", $links);
}

/**
 * Returns the language menu: one option per language the site has, each with the address of
 * this page in that language; src/js/lang-menu.js opens the chosen one.
 * @param string $label The menu's label in the page's language.
 * @return string The <select class="lang-menu"> element.
 */
function build_language_menu(string $label): string
{
    $options = '';
    foreach (get_site_languages((string)$GLOBALS['giitPage']['site']) as $language) {
        $current = $language === get_template_language() ? ' selected aria-current="page"' : '';
        $address = get_language_path($language, (string)$GLOBALS['giitPage']['path']) . '?' . PICK_PARAMETER . '=' . $language;
        $options .= '<option value="' . $language . '" lang="' . $language . '" data-href="' . escape_html($address) . '"' . $current . '>'
            . escape_html(LANGUAGE_NAMES[$language] ?? $language) . '</option>';
    }
    return '<select class="lang-menu" aria-label="' . escape_html($label) . '" title="' . escape_html($label) . '" data-no-i18n>' . $options . '</select>';
}

/**
 * Returns the entries of editors.json.
 * @return array<int, array<string,mixed>> The editors with key, name, url and online.
 */
function get_site_editors(): array
{
    return (array)($GLOBALS['giitPage']['editors']['editors'] ?? []);
}

/**
 * Returns the key of the site being served.
 * @return string The site key, e.g. "latex" or "overview".
 */
function get_site_key(): string
{
    return (string)$GLOBALS['giitPage']['site'];
}

/**
 * Escapes text for HTML content and attribute values.
 * @param string $text The text.
 * @return string The escaped text.
 */
function escape_html(string $text): string
{
    return htmlspecialchars($text, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8');
}

/* ---------- Reading the texts ---------- */

/**
 * Returns a text of the page's language, else the English one.
 * @param string $key The key, dotted for a nested text.
 * @return string The text, empty when no pack has it.
 */
function get_raw_text(string $key): string
{
    $value = get_value($key);
    return is_string($value) ? $value : '';
}

/**
 * Returns a value of the page's language, else the English one.
 * @param string $key The key, dotted for a nested value.
 * @return mixed The value, null when no pack has it.
 */
function get_value(string $key)
{
    $value = find_value((array)$GLOBALS['giitPage']['texts'], $key);
    return $value ?? find_value((array)$GLOBALS['giitPage']['fallback'], $key);
}

/**
 * Finds a dotted key in nested texts.
 * @param array<string,mixed> $texts The texts.
 * @param string $key The key, e.g. "embed.h1".
 * @return mixed The value, null when it is missing.
 */
function find_value(array $texts, string $key)
{
    $value = $texts;
    foreach (explode('.', $key) as $part) {
        if (!is_array($value) || !array_key_exists($part, $value)) {
            return null;
        }
        $value = $value[$part];
    }
    return $value;
}

/**
 * Puts values into the {name} placeholders of a text.
 * @param string $text The text.
 * @param array<string,string> $values The values by placeholder name.
 * @return string The text with the values.
 */
function apply_placeholders(string $text, array $values): string
{
    foreach ($values as $name => $value) {
        $text = str_replace('{' . $name . '}', $value, $text);
    }
    return $text;
}
