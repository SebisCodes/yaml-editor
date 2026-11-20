<?php
/**
 * Usage statistics: counts a page view in the metrics database, without cookies and
 * without storing anything on the visitor's device. The same file in every editor and
 * in the overview.
 *
 * Usage, at any point of the request (the row is written at the end of the request,
 * after the response has been sent if possible):
 *
 *     require __DIR__ . '/php/metrics.php';
 *     add_metrics_view();          // page = request path without query
 *     add_metrics_view('/de/');    // or a canonical page key
 *
 * What is stored per page view (nothing else, nothing on the device): date and hour
 * (minutes and seconds are dropped), site, page path, a daily visitor hash, country,
 * language, browser family and major version, OS family, device class, referrer host.
 * The IP is only hashed with a random salt of the day and looked up in the local country
 * table; the plain IP is never written. The salt of a day is deleted on the next day,
 * after which a hash cannot be traced back.
 *
 * Not counted: anything but GET, answers other than 200/304, prefetch and prerender,
 * Sec-GPC: 1 or DNT: 1 (the visitor's objection), bots (only a number per day and site
 * is kept for them). Bots are recognized by their User-Agent, by a missing
 * Accept-Language (every real browser sends one) and by a Chrome, Edge or Firefox
 * version that is over two years older than the current one or newer than possible
 * (computed from today's date). The site is the host without a leading "www."
 * (www.example.org = example.org).
 *
 * Access to the database (first match wins):
 *   1. METRICS_DB_HOST, METRICS_DB_PORT, METRICS_DB_NAME, METRICS_DB_USER,
 *      METRICS_DB_PASS from the environment (getenv, Apache SetEnv, or a .env the site
 *      has loaded itself);
 *   2. the .env shared by all sites, `.envs/giit.ch/.env` in the first folder above the
 *      document root that holds it (up to eight levels up), outside every web folder;
 *   3. otherwise <document root>/.env (local development).
 * Missing access = counting off. Every error is swallowed: the page always renders, and
 * the visitor never waits for the database (connect timeout of two seconds).
 *
 * METRICS_SITE (optional) sets the site name; without it the site is the host. It serves
 * e.g. a local test stack where hosts are *.localhost.
 *
 * Flow of one counted view:
 *   1. add_metrics_view() checks the request and registers the writer to run at
 *      shutdown.
 *   2. write_metrics_view() sends the response, reads the access and the site, and
 *      connects to the database.
 *   3. A bot adds one to the bot count of the day; any other visitor adds one event row.
 *   4. The first view of a day creates the salt of the day and removes what is past the
 *      retention.
 *
 * PHP 7.3 or newer, no extensions beyond PDO MySQL. The guard below keeps the file from
 * being declared twice when two scripts of one request load it.
 */

if (!defined('METRICS_CLIENT_VERSION')) {

define('METRICS_CLIENT_VERSION', '1.0.8');
/** Months of single events that are kept; older ones become monthly totals. */
define('METRICS_RETENTION_MONTHS', 6);
/** The time zone of the stored hours and days. */
define('METRICS_TIMEZONE', 'Europe/Zurich');
/** The keys read from the environment or a .env file. */
define('METRICS_ENV_KEYS', array('METRICS_DB_HOST', 'METRICS_DB_PORT', 'METRICS_DB_NAME', 'METRICS_DB_USER', 'METRICS_DB_PASS', 'METRICS_SITE'));
/** The shared .env, relative to a folder above the document root. */
define('METRICS_SHARED_ENV_FILE', '/.envs/giit.ch/.env');
/** How many folders above the document root are searched for the shared .env. */
define('METRICS_SHARED_ENV_LEVELS', 8);
define('METRICS_DEFAULT_DB_HOST', 'localhost');
define('METRICS_DEFAULT_DB_PORT', 3306);
/** Seconds to wait for the database connection. */
define('METRICS_CONNECT_TIMEOUT', 2);
/** The longest stored page key, host and referrer (an indexed column). */
define('METRICS_MAX_KEY_LENGTH', 191);
/** The part of the User-Agent that is read. */
define('METRICS_MAX_USER_AGENT', 512);
/** Hex characters of the stored visitor hash. */
define('METRICS_VISITOR_HASH_LENGTH', 32);
/** Bytes of the random salt of a day. */
define('METRICS_SALT_BYTES', 32);
/** The largest stored browser version (an unsigned 16-bit column). */
define('METRICS_MAX_BROWSER_VERSION', 65535);
/** A site name as stored: lowercase host characters. */
define('METRICS_SITE_PATTERN', '/^[a-z0-9.-]{1,64}$/');
/** User-Agents of bots, crawlers, tools and monitors. */
define('METRICS_BOT_PATTERN', '~bot\b|bot/|crawl|spider|slurp|archiver|curl/|wget|python-|python/|httpclient|okhttp|go-http|java/|libwww|'
    . 'node-fetch|axios|scrapy|headless|lighthouse|pagespeed|facebookexternalhit|embedly|preview|monitor|uptime|'
    . 'pingdom|statuscake|semrush|ahrefs|mj12|dotbot|petalbot|bytespider|gptbot|claude|perplexity|ccbot|feedfetcher|validator~i');
/** Browser families with the pattern of their major version, checked in this order. */
define('METRICS_BROWSER_RULES', array(
    array('~Edg(?:e|A|iOS)?/(\d+)~', 'Edge'),
    array('~(?:OPR|Opera)/(\d+)~', 'Opera'),
    array('~SamsungBrowser/(\d+)~', 'Samsung Internet'),
    array('~(?:Firefox|FxiOS)/(\d+)~', 'Firefox'),
    array('~(?:Chrome|CriOS)/(\d+)~', 'Chrome'),
    array('~Version/(\d+)[.\d]* (?:Mobile/\S+ )?Safari/~', 'Safari'),
));
/** A known release (major version, release date) of the browsers whose version is checked. */
define('METRICS_BROWSER_RELEASES', array(
    'Chrome' => array(120, '2023-12-05'),
    'Edge' => array(120, '2023-12-05'),
    'Firefox' => array(121, '2023-12-19'),
));
/** Days between two major versions of Chrome, Edge and Firefox. */
define('METRICS_RELEASE_CYCLE_DAYS', 28);
/** Versions older than the current one by more than this (about two years) count as bots. */
define('METRICS_MAX_VERSIONS_BEHIND', 26);
/** Versions newer than the current one by more than this count as bots. */
define('METRICS_MAX_VERSIONS_AHEAD', 3);

/**
 * Registers the page view once per request; the row is written at the end of the request.
 * Errors are swallowed: statistics never break a page.
 * @param string|null $page The canonical page key, or null for the request path.
 * @return void
 */
function add_metrics_view($page = null)
{
    static $registered = false;
    if ($registered) return;
    $registered = true;
    try {
        if (!is_metrics_request()) return;
        $pageKey = get_metrics_page_key($page);
        if ($pageKey === null) return;
        register_shutdown_function('write_metrics_view', $pageKey);
    } catch (Throwable $error) {
        // Statistics never break a page.
    }
}

/**
 * Tells whether this request is one that may and should be counted: a GET without the
 * visitor's objection (Sec-GPC, DNT) and not a prefetch, prerender or preview (a hover
 * over a link is no page view).
 * @return bool true when the request counts.
 */
function is_metrics_request()
{
    $server = $_SERVER;
    if (PHP_SAPI === 'cli') return false;
    if (($server['REQUEST_METHOD'] ?? '') !== 'GET') return false;
    if (trim($server['HTTP_SEC_GPC'] ?? '') === '1') return false;
    if (trim($server['HTTP_DNT'] ?? '') === '1') return false;
    $purpose = strtolower(($server['HTTP_SEC_PURPOSE'] ?? '') . ' ' . ($server['HTTP_PURPOSE'] ?? '') . ' ' . ($server['HTTP_X_MOZ'] ?? '')
        . ' ' . ($server['HTTP_X_PURPOSE'] ?? ''));
    return strpos($purpose, 'prefetch') === false && strpos($purpose, 'prerender') === false
        && strpos($purpose, 'preview') === false;
}

/**
 * Returns the page key: a clean path, never user input.
 * @param string|null $page The page key given by the caller, or null for the request path.
 * @return string|null the key, or null when the view is not counted.
 */
function get_metrics_page_key($page)
{
    if ($page === null) {
        $page = parse_url((string)($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
        if (!is_string($page)) return null;
        $page = rawurldecode($page);
    }
    $page = (string)$page;
    if ($page === '' || $page[0] !== '/') $page = '/' . $page;
    $page = preg_replace('#/{2,}#', '/', $page);
    $page = preg_replace('#/index\.(php|html?)$#', '/', $page);   // /de/index.html = /de/
    if (!preg_match('#^/[A-Za-z0-9._/-]*$#', $page)) return null;
    return substr($page, 0, METRICS_MAX_KEY_LENGTH);
}

/**
 * Returns the access data of the metrics database, read once per request.
 * @return array<string,string>|null the values of METRICS_ENV_KEYS, or null when counting
 *     is not configured.
 */
function get_metrics_config()
{
    static $config = false;
    if ($config !== false) return $config;
    $values = get_metrics_environment_values();
    if (!has_metrics_access($values)) {
        $envFile = get_metrics_env_file_path();
        $fileValues = $envFile === null ? null : read_metrics_env_file($envFile, METRICS_ENV_KEYS);
        foreach ($fileValues ?? array() as $key => $value) {
            if ($values[$key] === '') $values[$key] = $value;
        }
    }
    $config = has_metrics_access($values) ? $values : null;
    return $config;
}

/**
 * Returns the values of METRICS_ENV_KEYS from getenv, $_SERVER or $_ENV, in this order.
 * @return array<string,string> every key, an empty string when it is not set.
 */
function get_metrics_environment_values()
{
    $values = array();
    foreach (METRICS_ENV_KEYS as $key) {
        $value = getenv($key);
        if ($value === false || $value === '') $value = $_SERVER[$key] ?? ($_ENV[$key] ?? '');
        $values[$key] = (string)$value;
    }
    return $values;
}

/**
 * Tells whether the access data name a database and a user.
 * @param array<string,string> $values The values of METRICS_ENV_KEYS.
 * @return bool true when both are set.
 */
function has_metrics_access($values)
{
    return $values['METRICS_DB_NAME'] !== '' && $values['METRICS_DB_USER'] !== '';
}

/**
 * Returns the .env file to read: the shared one in the first folder above the document
 * root that holds it, else the site's own.
 * @return string|null the path, or null without a document root.
 */
function get_metrics_env_file_path()
{
    $root = rtrim((string)($_SERVER['DOCUMENT_ROOT'] ?? ''), '/');
    if ($root === '') return null;
    $realRoot = realpath($root);
    if ($realRoot !== false) $root = $realRoot;
    return find_metrics_shared_env_file($root) ?? $root . '/.env';
}

/**
 * Finds the shared .env in the given folder or one of the folders above it.
 * @param string $folder The folder to start in (the document root).
 * @return string|null the path of the shared .env, or null when none is found.
 */
function find_metrics_shared_env_file($folder)
{
    for ($level = 0; $level < METRICS_SHARED_ENV_LEVELS; $level++) {
        if (@is_file($folder . METRICS_SHARED_ENV_FILE)) return $folder . METRICS_SHARED_ENV_FILE;
        $parent = dirname($folder);
        if ($parent === $folder) return null;
        $folder = $parent;
    }
    return null;
}

/**
 * Reads the KEY=value lines of the given keys from a file. One matching pair of
 * surrounding quotes is taken off a value; a password may start or end with " or '.
 * @param string $file The path of the file.
 * @param string[] $keys The keys to read.
 * @return array<string,string>|null the values found, or null when the file is unreadable.
 */
function read_metrics_env_file($file, $keys)
{
    if (!is_file($file) || !is_readable($file)) return null;
    $lines = @file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if ($lines === false) return null;
    $found = array();
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#' || strpos($line, '=') === false) continue;
        list($key, $value) = explode('=', $line, 2);
        $key = trim($key);
        if (!in_array($key, $keys, true)) continue;
        $found[$key] = get_metrics_unquoted_value(trim($value));
    }
    return $found;
}

/**
 * Returns a value without one matching pair of surrounding quotes.
 * @param string $value The trimmed value of an env line.
 * @return string the value without the quotes.
 */
function get_metrics_unquoted_value($value)
{
    $length = strlen($value);
    if ($length >= 2 && ($value[0] === '"' || $value[0] === "'") && $value[$length - 1] === $value[0]) {
        return substr($value, 1, -1);
    }
    return $value;
}

/**
 * Returns the connection to the metrics database, opened on the first call.
 * @return PDO|null the connection, or null when counting is not configured.
 * @throws PDOException when the database cannot be reached.
 */
function get_metrics_db()
{
    static $connection = null;
    if ($connection !== null) return $connection;
    $config = get_metrics_config();
    if ($config === null) return null;
    $host = $config['METRICS_DB_HOST'] !== '' ? $config['METRICS_DB_HOST'] : METRICS_DEFAULT_DB_HOST;
    $port = $config['METRICS_DB_PORT'] !== '' ? (int)$config['METRICS_DB_PORT'] : METRICS_DEFAULT_DB_PORT;
    $connection = new PDO(
        'mysql:host=' . $host . ';port=' . $port . ';dbname=' . $config['METRICS_DB_NAME'] . ';charset=utf8mb4',
        $config['METRICS_DB_USER'],
        $config['METRICS_DB_PASS'],
        array(
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_TIMEOUT => METRICS_CONNECT_TIMEOUT,
            PDO::ATTR_EMULATE_PREPARES => false,
        )
    );
    return $connection;
}

/**
 * Shutdown function: sends the response, then writes the bot count or the event row.
 * Errors are swallowed: statistics never break a page.
 * @param string $page The page key.
 * @return void
 */
function write_metrics_view($page)
{
    try {
        if (!is_metrics_status_counted()) return;
        send_metrics_response();
        $config = get_metrics_config();
        if ($config === null) return;
        $host = get_metrics_host((string)($_SERVER['HTTP_HOST'] ?? ''));
        $site = get_metrics_site($config, $host);
        if ($site === '') return;
        $userAgent = substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, METRICS_MAX_USER_AGENT);
        $now = new DateTime('now', new DateTimeZone(METRICS_TIMEZONE));
        $db = get_metrics_db();
        if ($db === null) return;
        if (is_metrics_bot_request($userAgent)) {
            add_metrics_bot_hit($db, $now->format('Y-m-d'), $site);
            return;
        }
        add_metrics_event($db, $now, $site, $host, $page, $userAgent);
    } catch (Throwable $error) {
        // Statistics never break a page.
    }
}

/**
 * Tells whether the answer has a status that is counted (200 or 304).
 * @return bool true for a counted status.
 */
function is_metrics_status_counted()
{
    $status = (int)http_response_code();
    return $status === 200 || $status === 304;
}

/**
 * Sends the response to the visitor when the server allows it and keeps the script
 * running after the visitor has gone, so the visitor never waits for the database.
 * @return void
 */
function send_metrics_response()
{
    if (function_exists('fastcgi_finish_request')) @fastcgi_finish_request();
    ignore_user_abort(true);
}

/**
 * Returns the site name: METRICS_SITE or the host, without a leading "www.".
 * @param array<string,string> $config The access data.
 * @param string $host The cleaned host of the request.
 * @return string the site, or an empty string when it is not a valid name.
 */
function get_metrics_site($config, $host)
{
    $site = $config['METRICS_SITE'] !== '' ? strtolower($config['METRICS_SITE']) : $host;
    if (strpos($site, 'www.') === 0 && substr_count($site, '.') >= 2) $site = substr($site, 4);
    if ($site === '' || !preg_match(METRICS_SITE_PATTERN, $site)) return '';
    return $site;
}

/**
 * Tells whether the request comes from a bot: a bot User-Agent, no Accept-Language, or
 * an implausible browser version.
 * @param string $userAgent The User-Agent, cut to METRICS_MAX_USER_AGENT.
 * @return bool true for a bot.
 */
function is_metrics_bot_request($userAgent)
{
    return is_metrics_bot($userAgent) || trim((string)($_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? '')) === ''
        || is_implausible_browser_version($userAgent);
}

/**
 * Adds one to the bot count of a day and site.
 * @param PDO $db The metrics database.
 * @param string $day The day, YYYY-MM-DD.
 * @param string $site The site name.
 * @return void
 */
function add_metrics_bot_hit($db, $day, $site)
{
    $db->prepare('INSERT INTO metrics_bots (day, site, hits) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE hits = hits + 1')
       ->execute(array($day, $site));
}

/**
 * Writes the event row of one page view. The plain IP is only hashed and looked up in the
 * country table; it stays inside this function.
 * @param PDO $db The metrics database.
 * @param DateTime $now The time of the view.
 * @param string $site The site name.
 * @param string $host The cleaned host of the request.
 * @param string $page The page key.
 * @param string $userAgent The User-Agent, cut to METRICS_MAX_USER_AGENT.
 * @return void
 * @throws RuntimeException when the salt of the day cannot be read.
 */
function add_metrics_event($db, $now, $site, $host, $page, $userAgent)
{
    $server = $_SERVER;
    $ip = (string)($server['REMOTE_ADDR'] ?? '');
    $day = $now->format('Y-m-d');
    add_metrics_salt($db, $day);
    $visitor = get_metrics_visitor(get_metrics_salt($db, $day), $site, $ip, $userAgent);
    $country = get_metrics_country($db, $ip);
    list($browser, $version) = get_metrics_browser($userAgent);
    $os = get_metrics_os($userAgent);
    $device = get_metrics_device($userAgent, (string)($server['HTTP_SEC_CH_UA_MOBILE'] ?? ''));
    $language = get_metrics_language((string)($server['HTTP_ACCEPT_LANGUAGE'] ?? ''));
    $referrer = get_metrics_referrer((string)($server['HTTP_REFERER'] ?? ''), $host);
    $db->prepare('INSERT INTO metrics_events (ts, site, page, event, visitor, country, lang, browser, browser_ver, os, device, referrer)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
       // Only the hour: a time to the second could single out one visit on a quiet site.
       ->execute(array($now->format('Y-m-d H:00:00'), $site, $page, 'view', $visitor, $country, $language,
                       $browser, $version, $os, $device, $referrer));
}

/**
 * Returns the visitor hash of the day: site, IP and User-Agent keyed with the salt.
 * @param string $salt The salt of the day.
 * @param string $site The site name.
 * @param string $ip The IP of the visitor.
 * @param string $userAgent The User-Agent.
 * @return string the hash, METRICS_VISITOR_HASH_LENGTH hex characters.
 */
function get_metrics_visitor($salt, $site, $ip, $userAgent)
{
    return substr(hash_hmac('sha256', $site . '|' . $ip . '|' . $userAgent, $salt), 0, METRICS_VISITOR_HASH_LENGTH);
}

/**
 * Returns a host without port and without a trailing dot, lower case.
 * @param string $host The host as sent.
 * @return string the host, or an empty string when it is not a valid host name.
 */
function get_metrics_host($host)
{
    $host = strtolower(trim($host));
    $host = preg_replace('/:\d+$/', '', $host);
    $host = rtrim($host, '.');
    return preg_match('/^[a-z0-9.-]{1,253}$/', $host) ? $host : '';
}

/**
 * Creates the salt of a day when it is missing. The first writer of a day creates it
 * (INSERT IGNORE, then read back by get_metrics_salt, free of races) and removes what
 * is past the retention; errors of that removal are swallowed.
 * @param PDO $db The metrics database.
 * @param string $day The day, YYYY-MM-DD.
 * @return void
 */
function add_metrics_salt($db, $day)
{
    $insert = $db->prepare('INSERT IGNORE INTO metrics_salt (day, salt) VALUES (?, ?)');
    $insert->execute(array($day, random_bytes(METRICS_SALT_BYTES)));
    if ($insert->rowCount() === 1) {
        try { remove_expired_metrics($db, $day); } catch (Throwable $error) { }
    }
}

/**
 * Returns the salt of a day.
 * @param PDO $db The metrics database.
 * @param string $day The day, YYYY-MM-DD.
 * @return string the salt, METRICS_SALT_BYTES bytes.
 * @throws RuntimeException when there is no valid salt of that day.
 */
function get_metrics_salt($db, $day)
{
    $select = $db->prepare('SELECT salt FROM metrics_salt WHERE day = ?');
    $select->execute(array($day));
    $salt = $select->fetchColumn();
    if (!is_string($salt) || strlen($salt) !== METRICS_SALT_BYTES) throw new RuntimeException('no salt');
    return $salt;
}

/**
 * The daily housekeeping: deletes every older salt, folds the events past the retention
 * into monthly totals and deletes them, and deletes the old bot counts. The events are
 * deleted even when the totals fail: the retention promise comes first.
 * @param PDO $db The metrics database.
 * @param string $day The day, YYYY-MM-DD.
 * @return void
 */
function remove_expired_metrics($db, $day)
{
    $db->prepare('DELETE FROM metrics_salt WHERE day < ?')->execute(array($day));
    $retentionStart = get_metrics_retention_start($day);
    $cut = $retentionStart->format('Y-m-d 00:00:00');
    try { add_metrics_monthly_totals($db, $cut); } catch (Throwable $error) { }
    $db->prepare('DELETE FROM metrics_events WHERE ts < ?')->execute(array($cut));
    $db->prepare('DELETE FROM metrics_bots WHERE day < ?')->execute(array($retentionStart->format('Y-m-d')));
}

/**
 * Returns the first day that is kept: the first of the month, METRICS_RETENTION_MONTHS
 * months back.
 * @param string $day The day, YYYY-MM-DD.
 * @return DateTime the first kept day.
 */
function get_metrics_retention_start($day)
{
    $first = new DateTime($day, new DateTimeZone(METRICS_TIMEZONE));
    $first->modify('first day of this month')->modify('-' . METRICS_RETENTION_MONTHS . ' months');
    return $first;
}

/**
 * Adds the events older than a time to the monthly totals (visitors = sum of daily visitors).
 * @param PDO $db The metrics database.
 * @param string $cut The time in the database's form, midnight of the first kept day.
 * @return void
 */
function add_metrics_monthly_totals($db, $cut)
{
    $db->prepare("INSERT INTO metrics_monthly (month, site, views, visitors)
                  SELECT m, site, SUM(v), SUM(u) FROM (
                    SELECT DATE_FORMAT(ts, '%Y-%m') AS m, site, DATE(ts) AS d, COUNT(*) AS v, COUNT(DISTINCT visitor) AS u
                    FROM metrics_events WHERE ts < ? GROUP BY m, site, d) x
                  GROUP BY m, site
                  ON DUPLICATE KEY UPDATE views = views + VALUES(views), visitors = visitors + VALUES(visitors)")
       ->execute(array($cut));
}

/**
 * Returns the ISO country of an IP from the local country table; the IP leaves nothing
 * behind.
 * @param PDO $db The metrics database.
 * @param string $ip The IP of the visitor.
 * @return string|null two uppercase letters, or null when unknown.
 */
function get_metrics_country($db, $ip)
{
    $binary = @inet_pton($ip);
    if ($binary === false) return null;
    if (strlen($binary) === 4) $binary = str_repeat("\0", 10) . "\xff\xff" . $binary;   // IPv4-mapped IPv6
    $query = $db->prepare('SELECT ip_to, country FROM metrics_geo WHERE ip_from <= ? ORDER BY ip_from DESC LIMIT 1');
    $query->execute(array($binary));
    $row = $query->fetch(PDO::FETCH_NUM);
    if (!$row || strcmp($row[0], $binary) < 0) return null;
    $country = strtoupper((string)$row[1]);
    return preg_match('/^[A-Z]{2}$/', $country) ? $country : null;
}

/**
 * Tells whether a User-Agent is empty or names a bot, crawler, tool or monitor.
 * @param string $userAgent The User-Agent.
 * @return bool true for a bot.
 */
function is_metrics_bot($userAgent)
{
    if (trim($userAgent) === '') return true;
    return (bool)preg_match(METRICS_BOT_PATTERN, $userAgent);
}

/**
 * Tells whether a Chrome, Edge or Firefox version is one real visitors hardly use: more
 * than about two years older than the current one, or newer than possible. These
 * browsers release a major version every four weeks; the current version is computed
 * from a known release (METRICS_BROWSER_RELEASES), so the check does not go stale. Fixed,
 * outdated browser names are typical for scanners and bots.
 * @param string $userAgent The User-Agent.
 * @return bool true for an implausible version.
 */
function is_implausible_browser_version($userAgent)
{
    list($browser, $version) = get_metrics_browser($userAgent);
    $releases = METRICS_BROWSER_RELEASES;
    if ($version === null || !isset($releases[$browser])) return false;
    list($knownVersion, $knownDate) = $releases[$browser];
    $elapsed = max(0, time() - strtotime($knownDate . ' UTC'));
    $current = $knownVersion + intdiv($elapsed, METRICS_RELEASE_CYCLE_DAYS * 86400);
    return $version < $current - METRICS_MAX_VERSIONS_BEHIND || $version > $current + METRICS_MAX_VERSIONS_AHEAD;
}

/**
 * Returns the browser family and major version of a User-Agent.
 * @param string $userAgent The User-Agent.
 * @return array{0: string, 1: int|null} the family ("Other" when unknown) and the version.
 */
function get_metrics_browser($userAgent)
{
    foreach (METRICS_BROWSER_RULES as $rule) {
        if (preg_match($rule[0], $userAgent, $match)) return array($rule[1], min(METRICS_MAX_BROWSER_VERSION, (int)$match[1]));
    }
    return array('Other', null);
}

/**
 * Returns the operating system family of a User-Agent.
 * @param string $userAgent The User-Agent.
 * @return string iOS, Android, ChromeOS, Windows, macOS, Linux or Other.
 */
function get_metrics_os($userAgent)
{
    if (preg_match('~iPhone|iPad|iPod~', $userAgent)) return 'iOS';
    if (stripos($userAgent, 'Android') !== false) return 'Android';
    if (stripos($userAgent, 'CrOS') !== false) return 'ChromeOS';
    if (stripos($userAgent, 'Windows') !== false) return 'Windows';
    if (stripos($userAgent, 'Mac OS X') !== false || stripos($userAgent, 'Macintosh') !== false) return 'macOS';
    if (stripos($userAgent, 'Linux') !== false || stripos($userAgent, 'X11') !== false) return 'Linux';
    return 'Other';
}

/**
 * Returns the device class of a User-Agent.
 * @param string $userAgent The User-Agent.
 * @param string $mobileHint The Sec-CH-UA-Mobile header, "?1" on a phone.
 * @return string tablet, mobile or desktop.
 */
function get_metrics_device($userAgent, $mobileHint)
{
    if (preg_match('~iPad|Tablet|Kindle|Silk/|PlayBook~i', $userAgent)) return 'tablet';
    if (stripos($userAgent, 'Android') !== false && stripos($userAgent, 'Mobile') === false) return 'tablet';
    if (trim($mobileHint) === '?1' || preg_match('~Mobi|iPhone|iPod|Windows Phone~i', $userAgent)) return 'mobile';
    return 'desktop';
}

/**
 * Returns the first tag of Accept-Language, normalized (de-CH, de, en).
 * @param string $header The Accept-Language header.
 * @return string|null the language tag, or null when there is none.
 */
function get_metrics_language($header)
{
    $first = trim(explode(';', explode(',', $header)[0])[0]);
    if ($first === '' || $first === '*') return null;
    $parts = explode('-', str_replace('_', '-', $first));
    $language = strtolower($parts[0]);
    if (!preg_match('/^[a-z]{2,3}$/', $language)) return null;
    if (isset($parts[1]) && preg_match('/^([a-z]{2}|\d{3})$/i', $parts[1])) $language .= '-' . strtoupper($parts[1]);
    return $language;
}

/**
 * Returns the host of the referrer without a leading "www." (www.example.org = example.org).
 * @param string $referrer The Referer header.
 * @param string $ownHost The cleaned host of the request.
 * @return string|null the host, or null for none and for navigation inside the same host.
 */
function get_metrics_referrer($referrer, $ownHost)
{
    if ($referrer === '') return null;
    $host = parse_url($referrer, PHP_URL_HOST);
    if (!is_string($host)) return null;
    $host = get_metrics_host($host);
    if ($host === '' || $host === $ownHost) return null;
    if (strpos($host, 'www.') === 0 && substr_count($host, '.') >= 2) $host = substr($host, 4);
    return substr($host, 0, METRICS_MAX_KEY_LENGTH);
}

}
