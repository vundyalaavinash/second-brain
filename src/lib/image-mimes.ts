/** Image MIME types accepted for attachment upload, shared between the server-side
 * validator (`src/domain/attachments.ts`) and the editor's file picker/drop handling. */
export const ALLOWED_IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
