<?php
/**
 * The footer of every editor page: the giit mark with the address, all editors, the source
 * code and the legal pages, in the language of the page. Included by the page templates; the
 * same file in every editor.
 *
 * GitHub links open in a new tab. The German page lists the binding German legal pages;
 * every other page lists the English translations, then the German originals as the binding
 * ones.
 */

declare(strict_types=1);

$footerRepository = 'https://github.com/SebisCodes/' . get_site_key() . '-editor';
$footerLegalEnglish = ['imprint.html' => get_text('imprint'), 'privacy.html' => get_text('privacy'), 'terms.html' => get_text('terms')];
$footerLegalGerman = ['impressum.html' => 'Impressum', 'datenschutz.html' => 'Datenschutz', 'agb.html' => 'AGB'];
$footerShlsAuthor = '<a href="https://github.com/SebisCodes/SHLS-Sebis-Hierarchical-List-Structure"' . NEW_TAB_ATTRIBUTES . '>Sebastian Grünwald</a>';
?>
<footer class="footer site-footer">
    <div class="footer-grid">
        <section class="footer-brand" aria-label="giit.ch">
            <a class="footer-giit" href="https://giit.ch/"><img src="/img/giit.svg" alt="" width="22" height="25">giit.ch</a>
<?php if (get_site_key() === 'shls'): ?>
            <p class="footer-format"><?= str_replace('{author}', $footerShlsAuthor, get_text('footer_shls')) ?></p>
<?php endif; ?>
            <address>Grünwald Innovation<br>Sebastian Grünwald<br>Birchstrasse 6<br>8212 Neuhausen am Rheinfall<br>Switzerland<br><a href="mailto:info@giit.ch">info@giit.ch</a></address>
        </section>
        <nav class="footer-editors" aria-labelledby="footer-editors-title">
            <p class="footer-heading" id="footer-editors-title"><?= get_text('footer_editors') ?></p>
            <a class="footer-all" href="<?= escape_html(get_site_url('https://editors.giit.ch/')) ?>"><?= get_text('footer_all') ?> <span aria-hidden="true">→</span></a>
            <ul><?php foreach (get_site_editors() as $editor): if (!($editor['online'] ?? false)) continue; ?><li><a href="<?= escape_html(get_site_url((string)$editor['url'])) ?>"<?= $editor['key'] === get_site_key() ? ' aria-current="page"' : '' ?>><?= escape_html((string)$editor['name']) ?></a></li><?php endforeach; ?></ul>
        </nav>
        <nav class="footer-source" aria-labelledby="footer-source-title">
            <p class="footer-heading" id="footer-source-title"><?= get_text('footer_source') ?></p>
            <ul>
                <li><a class="source-link" href="<?= $footerRepository ?>"<?= NEW_TAB_ATTRIBUTES ?> aria-label="<?= get_text('source_on_github') ?>: github.com/SebisCodes/<?= get_site_key() ?>-editor"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg><span>github.com/<wbr>SebisCodes/<wbr><span class="repository-name"><?= get_site_key() ?>-editor</span></span></a></li>
                <li><?= str_replace('{license}', '<a href="' . $footerRepository . '/blob/main/LICENSE"' . NEW_TAB_ATTRIBUTES . '>Apache License 2.0</a>', get_text('footer_license')) ?></li>
                <li><a href="/llms.txt"><?= get_text('footer_llms') ?></a></li>
            </ul>
        </nav>
        <nav class="footer-legal" aria-labelledby="footer-legal-title">
            <p class="footer-heading" id="footer-legal-title"><?= get_text('footer_legal') ?></p>
<?php if (get_template_language() === 'de'): ?>
            <ul><?php foreach ($footerLegalGerman as $file => $label): ?><li><a href="/<?= $file ?>"><?= $label ?></a></li><?php endforeach; ?></ul>
<?php else: ?>
            <ul><?php foreach ($footerLegalEnglish as $file => $label): ?><li><a href="/<?= $file ?>"<?= get_template_language() === 'en' ? '' : ' hreflang="en"' ?>><?= $label ?></a></li><?php endforeach; ?></ul>
            <p class="footer-binding"><?= get_text('footer_binding') ?></p>
            <ul lang="de"><?php foreach ($footerLegalGerman as $file => $label): ?><li><a href="/<?= $file ?>"><?= $label ?></a></li><?php endforeach; ?></ul>
<?php endif; ?>
        </nav>
    </div>
    <p class="footer-bottom">© Grünwald Innovation, <?= get_text('country') ?></p>
</footer>
