<?php
/**
 * The developer page: markup and keys of the shared language packs (src/php/page.php).
 */
?>
<!DOCTYPE html>
<html <?= build_html_attributes() ?>>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob: https: http://localhost:* http://127.0.0.1:*; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'self'; form-action 'self'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= get_text('embed.title') ?></title>
<meta name="description" content="<?= get_text('embed.description') ?>">
<meta name="author" content="Sebastian Grünwald, Grünwald Innovation">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#2b59c3">
<link rel="canonical" href="<?= escape_html(get_page_url()) ?>">
<?= build_hreflang_links() ?>
<meta property="og:type" content="article">
<meta property="og:locale" content="<?= get_page_locale() ?>">
<meta property="og:site_name" content="YAML Editor">
<meta property="og:title" content="<?= get_text('embed.og_title') ?>">
<meta property="og:description" content="<?= get_text('embed.og_description') ?>">
<meta property="og:url" content="<?= escape_html(get_page_url()) ?>">
<meta property="og:image" content="https://yaml.giit.ch/img/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/svg+xml" href="/img/logo.svg">
<link rel="stylesheet" href="/css/style.css?v=26">
<script src="/js/theme.js?v=9"></script>
<script src="/js/lang-menu.js?v=1" defer></script>
<style>
.header .brand b { font-size: 17px; }
.path { margin: 0 0 18px; font-size: 14px; color: var(--muted); overflow-wrap: anywhere; }
.path span[aria-hidden] { margin: 0 6px; }
.developers h1 { font-size: 34px; line-height: 1.15; letter-spacing: -0.02em; margin: 0 0 14px; overflow-wrap: anywhere; }
.guide h2 { font-size: 21px; line-height: 1.3; margin: 30px 0 8px; }
.guide > h2:first-child { margin-top: 0; }
.developers p code { overflow-wrap: anywhere; }
@media (max-width: 600px) { .developers h1 { font-size: 27px; } }
</style>
<script type="application/ld+json"><?= get_json_ld('embed.jsonld') ?></script>
</head>
<body>

<header class="header">
    <a class="brand" href="<?= escape_html(get_language_path(get_template_language(), '')) ?>"><img src="/img/logo.svg" alt="" width="28" height="28"><b><?= get_text('name') ?></b></a>
    <span class="languages"><?= build_language_menu(get_text('language')) ?></span>
    <div class="schema" role="radiogroup" aria-label="<?= get_text('theme.group') ?>">
            <button type="button" role="radio" data-theme-set="light" aria-checked="false" title="<?= get_text('theme.light') ?>" aria-label="<?= get_text('theme.light') ?>"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg></button>
            <button type="button" role="radio" data-theme-set="dark" aria-checked="false" title="<?= get_text('theme.dark') ?>" aria-label="<?= get_text('theme.dark') ?>"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg></button>
            <button type="button" role="radio" data-theme-set="auto" aria-checked="true" title="<?= get_text('theme.auto_title') ?>" aria-label="<?= get_text('theme.auto_label') ?>"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg></button>
        </div>
    <a class="button primary" href="<?= escape_html(get_language_path(get_template_language(), '')) ?>"><?= get_text('embed.open') ?></a>
</header>

<main class="page-text developers">
    <nav class="path" aria-label="<?= get_text('embed.crumb_nav') ?>"><a href="<?= escape_html(get_language_path(get_template_language(), '')) ?>"><?= get_text('name') ?></a><span aria-hidden="true">›</span><span aria-current="page"><?= get_text('embed.crumb') ?></span></nav>
    <section class="text-section intro">
        <h1><?= get_text('embed.h1') ?></h1>
        <?= get_html('embed.intro') ?>
    </section>

    <section class="text-section guide">
        <?= get_html('embed.body') ?>
    </section>
</main>

<?php include __DIR__ . '/footer.php'; ?>

</body>
</html>
