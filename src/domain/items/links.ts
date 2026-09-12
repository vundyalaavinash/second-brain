import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";

export interface FetchedPage {
  title: string;
  text: string;
  byline: string | null;
  siteName: string | null;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 SecondBrain/1.0";

export async function fetchPage(url: string, fetchImpl: FetchLike = fetch): Promise<FetchedPage> {
  const res = await fetchImpl(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Fetch failed with status ${res.status}`);
  const html = await res.text();
  return extractReadable(html, url);
}

function tidy(text: string): string {
  return text
    .replace(/[ \t\r]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractReadable(html: string, url: string): FetchedPage {
  const { document } = parseHTML(html);
  const docTitle = document.querySelector("title")?.textContent?.trim() ?? "";
  let article: ReturnType<Readability["parse"]> = null;
  try {
    article = new Readability(document as unknown as Document).parse();
  } catch {
    article = null;
  }
  const articleText = article?.textContent ? tidy(article.textContent) : "";
  if (!articleText) {
    const bodyText = tidy(document.body?.textContent ?? "");
    return { title: docTitle || url, text: bodyText, byline: null, siteName: null };
  }
  return {
    title: (article?.title || docTitle || url).trim(),
    text: articleText,
    byline: article?.byline ?? null,
    siteName: article?.siteName ?? null,
  };
}
