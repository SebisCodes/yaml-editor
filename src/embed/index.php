<?php
/**
 * The developer page in the language of the request (src/templates/embed.php).
 */

declare(strict_types=1);

require __DIR__ . '/../php/site.php';
require __DIR__ . '/../php/page.php';
send_site_page(SITE_KEY, 'embed');
