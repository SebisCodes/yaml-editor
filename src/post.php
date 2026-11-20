<?php
/**
 * Receives one document by HTTP POST and answers with the editor's page holding it.
 * The same file in every editor.
 *
 * The document is untrusted data. It is never stored, logged, executed or included:
 * it only leaves this script inside an inert JSON block of the answer, every
 * character that could end that block escaped. The editor reads the block and renders
 * the document as it does for a link, in memory only.
 *
 * Request: POST application/x-www-form-urlencoded with
 *   content  the document as text, or
 *   b64      the document as base64 or base64url
 *   name     optional name of the document
 *   lang     optional language of the page, e.g. de
 * Allowed parameters in the address: viewer, embed, save, theme, tidy.
 *
 * Flow (a step whose check fails throws RefusedRequest; the flow then ends the request with
 * its fixed text):
 *   1. Send the security headers.
 *   2. Block a wrong method, a wrong content type, an oversized request and unknown
 *      address parameters.
 *   3. Read the document, its name and the language page from the form.
 *   4. Build the editor page in that language (src/php/page.php) and read the
 *      Content-Security-Policy of .htaccess.
 *   5. Send the page with the document as a JSON block in front of </head>.
 */

declare(strict_types=1);

ini_set('display_errors', '0');

require __DIR__ . '/php/site.php';
require __DIR__ . '/php/page.php';

/** Two whole Bibles fit in the document. */
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
/** Form encoding can triple the size of the text in the request. */
const MAX_REQUEST_BYTES = 64 * 1024 * 1024;
/** The parameters the address may carry; any other one is refused. */
const ALLOWED_QUERY_KEYS = ['viewer', 'embed', 'save', 'theme', 'tidy'];
/** The only content type taken. */
const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded';
/** The name of a document sent without one. */
const DEFAULT_DOCUMENT_NAME = 'Document';
/** The number of characters of a name that are kept. */
const MAX_NAME_CHARACTERS = 80;
/** The id of the JSON block the editor reads the document from. */
const DOCUMENT_BLOCK_ID = 'posted-doc';
/** A language page: two lowercase letters. */
const LANGUAGE_PATTERN = '/^[a-z]{2}$/D';
/** The Content-Security-Policy as .htaccess sets it for the static pages. */
const CSP_PATTERN = '/Content-Security-Policy "([^"]+)"/';
/**
 * JSON_HEX_* leaves no < > & ' " in the block: it cannot end the script element or start
 * markup. Other characters stay as they are, so the answer is not several times the size
 * of the document.
 */
const DOCUMENT_JSON_FLAGS = JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
    | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR;

const TEXT_ONLY_POST = 'Only POST.';
const TEXT_WRONG_TYPE = 'Send the form as application/x-www-form-urlencoded.';
const TEXT_TOO_LARGE = 'The document is too large.';
const TEXT_WRONG_PARAMETER = 'This address takes only viewer, embed, save, theme and tidy.';
const TEXT_BAD_BASE64 = 'The field b64 is not valid base64.';
const TEXT_NO_DOCUMENT = 'Send the document in the field content or b64.';
const TEXT_NOT_UTF8 = 'The document is not UTF-8 text.';
const TEXT_NAME_NOT_UTF8 = 'The name is not UTF-8 text.';
const TEXT_NO_LANGUAGE = 'There is no page in this language.';
const TEXT_NOT_AVAILABLE = 'The editor is not available.';

/**
 * A request this script does not answer with the page: its status, fixed text and further headers.
 */
final class RefusedRequest extends RuntimeException
{
    /**
     * Describes the answer to a refused request.
     * @param int $status The HTTP status code.
     * @param string $text The fixed text of the answer; nothing from the request.
     * @param string[] $headers Further header lines to send.
     * @return void
     */
    public function __construct(int $status, string $text, public readonly array $headers = [])
    {
        parent::__construct($text, $status);
    }
}

send_security_headers();
try {
    check_method();
    check_content_type();
    check_request_size();
    check_parameters();
    $document = read_posted_document();
    $name = read_posted_name();
    $language = read_posted_language();
    $page = build_editor_page($language);
    $policy = read_page_policy();
} catch (RefusedRequest $refusal) {
    stop_with_error($refusal->getCode(), $refusal->getMessage(), $refusal->headers);
}
send_page_with_document($page, $policy, $name, $document);

/**
 * Sends the headers every answer of this script carries.
 * @return void
 */
function send_security_headers(): void
{
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: strict-origin-when-cross-origin');
    header('Cache-Control: no-store');
    header('X-Robots-Tag: noindex');
}

/**
 * Refuses the request with 405 unless it is a POST.
 * @return void
 * @throws RefusedRequest for any other method.
 */
function check_method(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        throw new RefusedRequest(405, TEXT_ONLY_POST, ['Allow: POST']);
    }
}

/**
 * Refuses the request with 415 unless the body is a URL-encoded form.
 * @return void
 * @throws RefusedRequest for any other content type.
 */
function check_content_type(): void
{
    $type = strtolower(trim(explode(';', (string)($_SERVER['CONTENT_TYPE'] ?? ''))[0]));
    if ($type !== FORM_CONTENT_TYPE) {
        throw new RefusedRequest(415, TEXT_WRONG_TYPE);
    }
}

/**
 * Refuses the request with 413 when the body is over the request limit. PHP leaves $_POST
 * empty when the body is over its own limit (post_max_size), so a body without fields
 * counts as too large.
 * @return void
 * @throws RefusedRequest for a body over the limit.
 */
function check_request_size(): void
{
    $length = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($length > MAX_REQUEST_BYTES || ($length > 0 && !$_POST)) {
        throw new RefusedRequest(413, TEXT_TOO_LARGE);
    }
}

/**
 * Refuses the request with 400 when the address carries a parameter that is not allowed.
 * @return void
 * @throws RefusedRequest for a parameter outside ALLOWED_QUERY_KEYS.
 */
function check_parameters(): void
{
    foreach (array_keys($_GET) as $key) {
        if (!in_array($key, ALLOWED_QUERY_KEYS, true)) {
            throw new RefusedRequest(400, TEXT_WRONG_PARAMETER);
        }
    }
}

/**
 * Returns the document of the form: the field content, or else the decoded field b64.
 * @return string the document text.
 * @throws RefusedRequest when there is no document, it is too large or not UTF-8 text.
 */
function read_posted_document(): string
{
    $content = $_POST['content'] ?? null;
    $base64 = $_POST['b64'] ?? null;
    if ($content === null && is_string($base64)) {
        $content = base64_decode(strtr($base64, '-_', '+/'), true);
        if ($content === false) {
            throw new RefusedRequest(400, TEXT_BAD_BASE64);
        }
    }
    if (!is_string($content) || $content === '') {
        throw new RefusedRequest(400, TEXT_NO_DOCUMENT);
    }
    if (strlen($content) > MAX_DOCUMENT_BYTES) {
        throw new RefusedRequest(413, TEXT_TOO_LARGE);
    }
    if (!is_clean_text($content)) {
        throw new RefusedRequest(400, TEXT_NOT_UTF8);
    }
    return $content;
}

/**
 * Returns the name of the form without control characters, cut to its first characters.
 * @return string the name to show, possibly empty.
 * @throws RefusedRequest when the name is not UTF-8 text.
 */
function read_posted_name(): string
{
    $name = $_POST['name'] ?? DEFAULT_DOCUMENT_NAME;
    if (!is_string($name) || !is_clean_text($name)) {
        throw new RefusedRequest(400, TEXT_NAME_NOT_UTF8);
    }
    $printable = preg_replace('/[\x00-\x1f\x7f]/u', '', $name) ?? '';
    preg_match('/^.{0,' . MAX_NAME_CHARACTERS . '}/us', $printable, $kept);
    return $kept[0] ?? '';
}

/**
 * Returns the language the form asks for, English without one. Only a language of the shared
 * language packs is taken.
 * @return string the language code.
 * @throws RefusedRequest for any other value.
 */
function read_posted_language(): string
{
    $language = $_POST['lang'] ?? '';
    if ($language === '') {
        return ROOT_LANGUAGE;
    }
    if (!is_string($language) || preg_match(LANGUAGE_PATTERN, $language) !== 1 || !has_language_pack($language)) {
        throw new RefusedRequest(400, TEXT_NO_LANGUAGE);
    }
    return $language;
}

/**
 * Builds the editor page in a language.
 * @param string $language The language code.
 * @return string the page's HTML.
 * @throws RefusedRequest when the page cannot be built or has no </head>.
 */
function build_editor_page(string $language): string
{
    $page = build_site_page(SITE_KEY, 'editor', $language);
    if (strpos($page, '</head>') === false) {
        throw new RefusedRequest(500, TEXT_NOT_AVAILABLE);
    }
    return $page;
}

/**
 * Returns the Content-Security-Policy that .htaccess sets for the static pages.
 * @return string the policy.
 * @throws RefusedRequest when it cannot be read.
 */
function read_page_policy(): string
{
    $rules = file_get_contents(__DIR__ . '/.htaccess');
    if ($rules === false || preg_match(CSP_PATTERN, $rules, $policy) !== 1) {
        throw new RefusedRequest(500, TEXT_NOT_AVAILABLE);
    }
    return $policy[1];
}

/**
 * Sends the editor page with the document as an inert JSON block right in front of </head>.
 * @param string $page The editor page's HTML, holding </head>.
 * @param string $policy The Content-Security-Policy of the page.
 * @param string $name The name of the document.
 * @param string $document The document text, valid UTF-8.
 * @return void
 * @throws JsonException when the document cannot be written as JSON.
 */
function send_page_with_document(string $page, string $policy, string $name, string $document): void
{
    $json = json_encode(['name' => $name, 'content' => $document], DOCUMENT_JSON_FLAGS);
    $block = '<script type="application/json" id="' . DOCUMENT_BLOCK_ID . '">' . $json . "</script>\n";
    header('Content-Type: text/html; charset=utf-8');
    header('Content-Security-Policy: ' . $policy);
    echo substr_replace($page, $block, strpos($page, '</head>'), 0);
}

/**
 * Ends the request with a fixed text; nothing from the request is echoed.
 * @param int $status The HTTP status code.
 * @param string $text The text of the answer.
 * @param string[] $headers Further header lines to send.
 * @return never
 */
function stop_with_error(int $status, string $text, array $headers = []): never
{
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    foreach ($headers as $header) {
        header($header);
    }
    echo $text . "\n";
    exit;
}

/**
 * Tells whether a text is valid UTF-8 without a NUL character.
 * @param string $text The text to test.
 * @return bool true when the text is clean.
 */
function is_clean_text(string $text): bool
{
    return preg_match('//u', $text) === 1 && !str_contains($text, "\0");
}
