const para =
  "The second brain keeps every note, link, and meeting in one place so that nothing gets lost and everything can be found again later. ";

/** An article page with enough text for Readability to extract it. */
export const ARTICLE_HTML = `<html><head><title>Test Article | Site</title><meta name="author" content="Ada"></head>
<body><nav>Home About</nav><article><h1>Test Article</h1>
<p>${para.repeat(3)}</p><p>${para.repeat(3)}</p><p>${para.repeat(3)}</p></article><footer>copyright</footer></body></html>`;
