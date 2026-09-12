const para =
  "The second brain keeps every note, link, and meeting in one place so that nothing gets lost and everything can be found again later. ";

/** An article page with enough text for Readability to extract it. */
export const ARTICLE_HTML = `<html><head><title>Test Article | Site</title><meta name="author" content="Ada"></head>
<body><nav>Home About</nav><article><h1>Test Article</h1>
<p>${para.repeat(3)}</p><p>${para.repeat(3)}</p><p>${para.repeat(3)}</p></article><footer>copyright</footer></body></html>`;

/** A one-page PDF whose only text is "Hello Brain". */
export const MINIMAL_PDF: Buffer = Buffer.from(
  `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 42 >> stream
BT /F1 18 Tf 20 40 Td (Hello Brain) Tj ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
trailer << /Root 1 0 R >>
%%EOF`,
  "latin1",
);
