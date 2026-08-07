# Documents setup

1. Review and execute `supabase/documents.sql` once in Supabase SQL Editor. It creates document metadata/version tables, a private `documents` bucket, validation triggers, RLS, and Storage policies.
2. The bucket is private. The app creates short-lived signed URLs for preview/download; never make it public.
3. The MVP UI limits uploads to 50 MB, matching the migration bucket limit. Confirm the project-wide Supabase upload limit also permits the desired size.
4. Storage paths are generated as `organization_id/documents/document_id/version/UUID.extension`; the displayed original filename is metadata only.
5. After migration, test with an authenticated organization member: upload PDF/image/DOCX, preview supported files, download, edit metadata, add a version, download an older version, and delete. Confirm another organization cannot list metadata or access a guessed path.

No AI/OCR processing is enabled. `processing_status` is only a safe extension point for later processing.
