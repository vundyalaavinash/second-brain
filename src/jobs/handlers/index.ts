import type { DB } from "@/db/client";
import type { JobHandlers } from "@/jobs/worker";
import type { EmbedProvider } from "@/providers/embed/types";
import type { FetchLike } from "@/domain/items/links";
import type { PdfExtractFn, OcrFn } from "@/domain/items/extract";
import { createEmbedHandler } from "./embed";
import { createFetchLinkHandler } from "./fetch-link";
import { createExtractPdfHandler } from "./extract-pdf";
import { createOcrImageHandler } from "./ocr-image";
import { createBackupHandler } from "./backup";

export interface HandlerDeps {
  db: DB;
  embed: EmbedProvider | null;
  fetchImpl?: FetchLike;
  extractPdf?: PdfExtractFn;
  ocr?: OcrFn;
}

export function createJobHandlers(deps: HandlerDeps): JobHandlers {
  return {
    embed: createEmbedHandler({ db: deps.db, embed: deps.embed }),
    fetch_link: createFetchLinkHandler({ db: deps.db, fetchImpl: deps.fetchImpl }),
    extract_pdf: createExtractPdfHandler({ db: deps.db, extract: deps.extractPdf }),
    ocr_image: createOcrImageHandler({ db: deps.db, ocr: deps.ocr }),
    backup: createBackupHandler({ db: deps.db }),
  };
}
