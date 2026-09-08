import { extractText } from 'unpdf';

export interface ParsedDocument {
  filename: string;
  fileType: 'pdf' | 'email' | 'text' | 'html' | 'calendar' | 'unknown';
  size: number;
  text: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

/** Unescape Quoted-Printable strings (=20, =3D, =C3=A9, soft line breaks =\r\n) */
export function unescapeQuotedPrintable(raw: string): string {
  const withoutSoftBreaks = raw.replace(/=\r?\n/g, '');
  return withoutSoftBreaks.replace(/=([0-9A-Fa-f]{2})/g, (_match, hex) => {
    try {
      const code = parseInt(hex, 16);
      return String.fromCharCode(code);
    } catch {
      return '';
    }
  });
}

/** Decode MIME encoded-words like =?utf-8?B?...?= or =?utf-8?Q?...?= */
export function decodeMimeWords(raw: string): string {
  if (!raw || !raw.includes('=?')) return raw;
  return raw.replace(/=\?([^?]+)\?([A-Za-z])\?([^?]+)\?=/g, (_match, _charset, encoding, encodedText) => {
    try {
      const enc = encoding.toUpperCase();
      if (enc === 'B') {
        return Buffer.from(encodedText, 'base64').toString('utf8');
      }
      if (enc === 'Q') {
        const qp = encodedText.replace(/_/g, ' ');
        return unescapeQuotedPrintable(qp);
      }
      return encodedText;
    } catch {
      return encodedText;
    }
  });
}

/** Convert HTML content into readable plain text with preserved line structure */
export function stripHtmlToText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '  ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

/** Parse an RFC822 / .eml format email string or buffer */
export function parseEmlContent(input: string | Buffer): {
  subject: string;
  from: string;
  to: string;
  date: string;
  body: string;
} {
  const raw = typeof input === 'string' ? input : input.toString('utf8');
  const splitIdx = raw.search(/\r?\n\r?\n/);
  const headerSection = splitIdx >= 0 ? raw.slice(0, splitIdx) : raw;
  const bodySection = splitIdx >= 0 ? raw.slice(splitIdx).replace(/^\r?\n\r?\n/, '') : '';

  // Unfold multi-line headers
  const unfolded = headerSection.replace(/\r?\n[ \t]+/g, ' ');
  const headers: Record<string, string> = {};
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon > 0) {
      const key = line.slice(0, colon).trim().toLowerCase();
      const val = line.slice(colon + 1).trim();
      headers[key] = headers[key] ? `${headers[key]}; ${val}` : val;
    }
  }

  const subject = decodeMimeWords(headers['subject'] || '(No Subject)');
  const from = decodeMimeWords(headers['from'] || '');
  const to = decodeMimeWords(headers['to'] || '');
  const date = headers['date'] || '';

  const contentType = headers['content-type'] || 'text/plain';
  const transferEncoding = (headers['content-transfer-encoding'] || '').toLowerCase();

  let body = '';

  // Handle multipart messages
  const boundaryMatch = contentType.match(/boundary=["']?([^"';]+)["']?/i);
  if (boundaryMatch) {
    const boundary = boundaryMatch[1].trim();
    const parts = bodySection.split(new RegExp(`--${boundary}(?:--)?`, 'g'));
    let plainPart = '';
    let htmlPart = '';

    for (const part of parts) {
      const p = part.trim();
      if (!p || p === '--') continue;
      const partSplit = p.search(/\r?\n\r?\n/);
      const pHeader = partSplit >= 0 ? p.slice(0, partSplit) : '';
      let pBody = partSplit >= 0 ? p.slice(partSplit).replace(/^\r?\n\r?\n/, '') : p;

      const pTransfer = (pHeader.match(/content-transfer-encoding:\s*([^\r\n;]+)/i)?.[1] || '').trim().toLowerCase();
      if (pTransfer === 'base64') {
        try {
          pBody = Buffer.from(pBody.replace(/\s+/g, ''), 'base64').toString('utf8');
        } catch {
          // ignore
        }
      } else if (pTransfer === 'quoted-printable') {
        pBody = unescapeQuotedPrintable(pBody);
      }

      if (/content-type:[^\r\n]*text\/plain/i.test(pHeader)) {
        plainPart = pBody;
      } else if (/content-type:[^\r\n]*text\/html/i.test(pHeader)) {
        htmlPart = pBody;
      }
    }

    if (plainPart.trim()) {
      body = plainPart.trim();
    } else if (htmlPart.trim()) {
      body = stripHtmlToText(htmlPart);
    }
  }

  if (!body) {
    let decoded = bodySection;
    if (transferEncoding === 'base64') {
      try {
        decoded = Buffer.from(bodySection.replace(/\s+/g, ''), 'base64').toString('utf8');
      } catch {
        decoded = bodySection;
      }
    } else if (transferEncoding === 'quoted-printable') {
      decoded = unescapeQuotedPrintable(bodySection);
    }

    if (/text\/html/i.test(contentType) || /<html|<div|<body|<table/i.test(decoded)) {
      body = stripHtmlToText(decoded);
    } else {
      body = decoded.trim();
    }
  }

  return { subject, from, to, date, body };
}

/**
 * Sanitize text extracted from documents:
 * - Strip NUL bytes (\0 / \u0000) that crash PostgreSQL UTF-8 text columns.
 * - Repair broken ligatures (e.g. from missing ToUnicode CMaps in PDF fonts where 'ti', 'tt', 'ft' map to \0 or \uFFFD).
 * - Strip unprintable control characters while preserving valid whitespace (\n, \r, \t).
 */
export function sanitizeDocumentText(raw: string): string {
  if (!raw) return '';
  return raw
    // Repair common travel words where PDF font ligature issues produced \0 or \uFFFD (replacement char)
    .replace(/Addi[\0\uFFFD]onal/gi, 'Additional')
    .replace(/un[\0\uFFFD]l\b/gi, 'until')
    .replace(/informa[\0\uFFFD]on/gi, 'information')
    .replace(/h[\0\uFFFD]ps:\/\//gi, 'https://')
    .replace(/reserva[\0\uFFFD]ons/gi, 'reservations')
    .replace(/FunAc[\0\uFFFD]ve/gi, 'FunActive')
    .replace(/Gesellscha[\0\uFFFD]sitz/gi, 'Gesellschaftssitz')
    .replace(/Gesellscha[\0\uFFFD]skapital/gi, 'Gesellschaftskapital')
    .replace(/iscri[\0\uFFFD]o/gi, 'iscritto')
    // Remove any remaining null characters
    .replace(/\0/g, '')
    // Remove ASCII control characters (1-8, 11-12, 14-31, 127) except tab (\t), newline (\n), carriage return (\r)
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim();
}

/**
 * Attempt extraction via Apache Tika server if available.
 */
export async function extractWithTika(
  buffer: Buffer,
  filename: string,
  mimetype?: string
): Promise<{ text: string; charCount: number } | null> {
  const tikaUrl = process.env.TIKA_URL || 'http://192.168.86.86:9998';
  if (!tikaUrl) return null;

  const timeoutMs = parseInt(process.env.TIKA_TIMEOUT_MS || '20000', 10);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${tikaUrl.replace(/\/+$/, '')}/tika`, {
      method: 'PUT',
      headers: {
        Accept: 'text/plain',
        ...(mimetype ? { 'Content-Type': mimetype } : {}),
      },
      body: buffer,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const text = await res.text();
    const cleaned = sanitizeDocumentText(
      text
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n\s*\n+/g, '\n\n')
        .trim()
    );
    if (!cleaned) return null;
    return { text: cleaned, charCount: cleaned.length };
  } catch {
    return null;
  }
}

/**
 * Main parser entry point: extract clean text and travel context from uploaded files.
 */
export async function extractDocumentText(file: {
  buffer: Buffer;
  originalname: string;
  mimetype?: string;
}): Promise<ParsedDocument> {
  const filename = file.originalname || 'document';
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const mime = (file.mimetype || '').toLowerCase();
  const size = file.buffer.length;

  // 1. Office / Binary Document Files (.docx, .doc, .xlsx, .xls, .pptx, .rtf, .odt, pages, numbers)
  const officeExts = ['docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'rtf', 'odt', 'pages', 'numbers'];
  if (officeExts.includes(ext)) {
    const tika = await extractWithTika(file.buffer, filename, mime);
    if (tika && tika.text) {
      return {
        filename,
        fileType: 'unknown',
        size,
        text: tika.text,
        summary: `Document (${tika.charCount} characters extracted via Apache Tika)`,
        metadata: { parser: 'apache-tika', charCount: tika.charCount },
      };
    }
  }

  // 2. PDF Files
  if (ext === 'pdf' || mime === 'application/pdf') {
    // Quickly detect total pages from PDF structure
    let totalPages: number | undefined;
    let unpdfText = '';
    try {
      const parsed = await extractText(new Uint8Array(file.buffer), { mergePages: true });
      totalPages = parsed.totalPages;
      const rawText = Array.isArray(parsed.text) ? parsed.text.join('\n\n') : String(parsed.text || '');
      unpdfText = sanitizeDocumentText(
        rawText
          .replace(/\r\n/g, '\n')
          .replace(/[ \t]+/g, ' ')
          .replace(/\n\s*\n\s*\n+/g, '\n\n')
          .trim()
      );
    } catch {
      // unpdf failed on this PDF buffer, fallback to Tika
    }

    // Attempt Tika server first (handles full PDFBox layout, OCR, and complex font encodings)
    const tika = await extractWithTika(file.buffer, filename, mime);
    if (tika && tika.text && tika.text.length >= 10) {
      const pageInfo = totalPages ? `${totalPages} page${totalPages === 1 ? '' : 's'}, ` : '';
      return {
        filename,
        fileType: 'pdf',
        size,
        text: tika.text,
        summary: `PDF document (${pageInfo}${tika.charCount} characters extracted via Apache Tika)`,
        metadata: { parser: 'apache-tika', charCount: tika.charCount, totalPages },
      };
    }

    // Fallback to local unpdf parser
    if (unpdfText) {
      const pageInfo = totalPages ? `${totalPages} page${totalPages === 1 ? '' : 's'}, ` : '';
      return {
        filename,
        fileType: 'pdf',
        size,
        text: unpdfText,
        summary: `PDF document (${pageInfo}${unpdfText.length} characters extracted)`,
        metadata: { totalPages, charCount: unpdfText.length, parser: 'unpdf' },
      };
    }

    return {
      filename,
      fileType: 'pdf',
      size,
      text: `[Note: PDF "${filename}" contained no selectable text. It may be a scanned image.]`,
      summary: `PDF document (${totalPages ? `${totalPages} page${totalPages === 1 ? '' : 's'}` : 'empty'})`,
      metadata: { totalPages, charCount: 0, parser: 'empty' },
    };
  }

  // 3. Image Files (.png, .jpg, .jpeg, .webp, .tiff) with potential OCR via Tika
  const imageExts = ['png', 'jpg', 'jpeg', 'webp', 'tiff', 'tif', 'bmp'];
  if (imageExts.includes(ext) || mime.startsWith('image/')) {
    const tika = await extractWithTika(file.buffer, filename, mime);
    if (tika && tika.text && tika.text.length >= 10) {
      return {
        filename,
        fileType: 'unknown',
        size,
        text: tika.text,
        summary: `Image text (${tika.charCount} characters extracted via Apache Tika OCR)`,
        metadata: { parser: 'apache-tika-ocr', charCount: tika.charCount },
      };
    }
  }

  // 4. Email Files (.eml, .msg, message/rfc822)
  if (ext === 'eml' || ext === 'msg' || mime.includes('rfc822') || mime.includes('message/')) {
    try {
      const parsed = parseEmlContent(file.buffer);
      const textParts: string[] = [];
      if (parsed.subject) textParts.push(`Subject: ${parsed.subject}`);
      if (parsed.from) textParts.push(`From: ${parsed.from}`);
      if (parsed.to) textParts.push(`To: ${parsed.to}`);
      if (parsed.date) textParts.push(`Date: ${parsed.date}`);
      textParts.push('');
      textParts.push(parsed.body);

      const fullText = sanitizeDocumentText(textParts.join('\n').trim());
      const summary = `Email: "${parsed.subject || filename}" (${fullText.length} characters)`;
      return {
        filename,
        fileType: 'email',
        size,
        text: fullText,
        summary,
        metadata: { subject: parsed.subject, from: parsed.from, date: parsed.date },
      };
    } catch (err) {
      return {
        filename,
        fileType: 'email',
        size,
        text: `[Error parsing email "${filename}": ${(err as Error).message}]`,
        summary: `Failed to parse email`,
      };
    }
  }

  // 5. HTML Confirmation Pages
  if (ext === 'html' || ext === 'htm' || mime.includes('html')) {
    const rawHtml = file.buffer.toString('utf8');
    const cleaned = sanitizeDocumentText(stripHtmlToText(rawHtml));
    return {
      filename,
      fileType: 'html',
      size,
      text: cleaned,
      summary: `HTML Document (${cleaned.length} characters)`,
    };
  }

  // 6. Calendar (.ics)
  if (ext === 'ics' || mime.includes('calendar')) {
    const raw = sanitizeDocumentText(file.buffer.toString('utf8'));
    return {
      filename,
      fileType: 'calendar',
      size,
      text: raw,
      summary: `iCalendar schedule data`,
    };
  }

  // 7. Plain text / Markdown / Notes / CSV / JSON
  const textExts = ['txt', 'text', 'md', 'markdown', 'csv', 'json', 'yaml', 'yml', 'tsv'];
  if (textExts.includes(ext) || mime.startsWith('text/')) {
    const utf8 = sanitizeDocumentText(file.buffer.toString('utf8'));
    return {
      filename,
      fileType: 'text',
      size,
      text: utf8.trim(),
      summary: `Text document (${utf8.length} characters)`,
    };
  }

  // 8. Unknown / Fallback: Attempt Tika, else UTF-8 text if valid
  const tika = await extractWithTika(file.buffer, filename, mime);
  if (tika && tika.text) {
    return {
      filename,
      fileType: 'unknown',
      size,
      text: tika.text,
      summary: `Document (${tika.charCount} characters extracted via Apache Tika)`,
      metadata: { parser: 'apache-tika', charCount: tika.charCount },
    };
  }

  const utf8 = sanitizeDocumentText(file.buffer.toString('utf8'));
  return {
    filename,
    fileType: 'text',
    size,
    text: utf8.trim(),
    summary: `Text document (${utf8.length} characters)`,
  };
}
