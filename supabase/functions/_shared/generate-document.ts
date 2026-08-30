// Turns agent-authored text into a real, editable file. Tries a proper
// .docx first (the `docx` package is pure JS/browser-safe by design, so it
// should load fine via esm.sh under Deno the same way @supabase/supabase-js
// already does elsewhere in this project) and falls back to a hand-built
// .rtf — still fully editable in Word/LibreOffice/Google Docs — if that
// import or generation fails for any reason, so this feature degrades
// gracefully instead of breaking the whole auto-triage function.
export async function buildDocumentFile(content: string, title: string) {
  try {
    return await buildDocx(content, title);
  } catch (error) {
    console.error("docx generation failed, falling back to RTF", error);
    return buildRtf(content);
  }
}

async function buildDocx(content: string, title: string) {
  const docx = await import("https://esm.sh/docx@9");
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = docx;
  const paragraphs = [
    new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }),
    ...content.split(/\n{2,}/).map((block: string) =>
      new Paragraph({ children: [new TextRun(block.trim())] })
    ),
  ];
  const document = new Document({ sections: [{ children: paragraphs }] });
  const blob = await Packer.toBlob(document);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return {
    bytes,
    extension: "docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
}

function escapeRtf(text: string) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\r?\n/g, "\\par\n");
}

function buildRtf(content: string) {
  const rtf = `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Calibri;}}\\f0\\fs22 ${escapeRtf(content)}}`;
  return {
    bytes: new TextEncoder().encode(rtf),
    extension: "rtf",
    mimeType: "application/rtf",
  };
}
