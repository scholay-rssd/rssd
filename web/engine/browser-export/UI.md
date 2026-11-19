# Article reading and sharing

The article itself is the styled reading surface. Typography is selected by the
explicit site/category template. Keep the site header, canonical URL, language
navigation, source links, course/event facts and related project links.

A fixed Share button on article and note pages opens a compact panel for
readers: copy the page's address, the system share sheet where the browser has
one, a poster with the page's QR code, and a Weibo link. The poster
is drawn in the reader's browser (`poster.mjs`, `qr.mjs`, loaded only when asked)
in the article's light colours; on a phone it is saved by pressing and holding. Card pages carry no panel. Old export
bookmarks redirect to their canonical article with the panel open.

The site offers no copy-for-WeChat, HTML download or page-image ZIP. Those
outputs are for distribution, and part-time staff make them in the desktop app
and the Obsidian plug-in. The plug-in reuses this directory's page engine
(`pagination.mjs`, `raster.mjs`, `wechat-clipboard.mjs`), so those modules stay
here, but the site does not ship them.

Each category explicitly owns a light and a dark palette. The live article and
share panel follow the site color mode.
