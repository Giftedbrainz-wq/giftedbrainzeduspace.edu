# EduSpace v12.12.0 — typography and mobile density

- Replaced Baskerville/Baskervville with Plus Jakarta Sans via Google Fonts, using CSS/system fallbacks (no binary fonts bundled).
- Added `public/typography.css` after page-level styles for compact mobile headings, card spacing, chat and exam text, retaining 16px form controls to avoid iOS auto-zoom.
- Reduced decorative homepage/intro headings on 320–600px widths.
- Kept KaTeX maths notation, code blocks, existing CBT icons and video thumbnails untouched.
- Bumped versioned scripts, service worker and static cache to 12.12.0.
- Alternative webfonts to evaluate later: Manrope (more geometric) and DM Sans (more neutral).

To revert the typography only, restore `public/styles.css` font token and old Google Fonts link, and remove the `/typography.css` link. Existing app data is unchanged.

Live appearance depends on whether Google Fonts is reachable; always review on iOS and Android after deployment.
