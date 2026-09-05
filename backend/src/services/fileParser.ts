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

  // 1. PDF Files
  if (ext === 'pdf' || mime === 'application/pdf') {
    try {
      const { text, totalPages } = await extractText(new Uint8Array(file.buffer), { mergePages: true });
      const rawText = Array.isArray(text) ? text.join('\n\n') : String(text || '');
      const cleaned = rawText
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n\s*\n+/g, '\n\n')
        .trim();

      const summary = `PDF document (${totalPages} page${totalPages === 1 ? '' : 's'}, ${cleaned.length} characters extracted)`;
      return {
        filename,
        fileType: 'pdf',
        size,
        text: cleaned || `[Note: PDF "${filename}" contained no selectable text. It may be a scanned image.]`,
        summary,
        metadata: { totalPages, charCount: cleaned.length },
      };
    } catch (err) {
      return {
        filename,
        fileType: 'pdf',
        size,
        text: `[Error parsing PDF "${filename}": ${(err as Error).message}]`,
        summary: `Failed to extract text from PDF`,
      };
    }
  }

  // 2. Email Files (.eml, .msg, message/rfc822)
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

      const fullText = textParts.join('\n').trim();
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

  // 3. HTML Confirmation Pages
  if (ext === 'html' || ext === 'htm' || mime.includes('html')) {
    const rawHtml = file.buffer.toString('utf8');
    const cleaned = stripHtmlToText(rawHtml);
    return {
      filename,
      fileType: 'html',
      size,
      text: cleaned,
      summary: `HTML Document (${cleaned.length} characters)`,
    };
  }

  // 4. Calendar (.ics)
  if (ext === 'ics' || mime.includes('calendar')) {
    const raw = file.buffer.toString('utf8');
    return {
      filename,
      fileType: 'calendar',
      size,
      text: raw,
      summary: `iCalendar schedule data`,
    };
  }

  // 5. Plain text / Markdown / Notes
  const utf8 = file.buffer.toString('utf8');
  return {
    filename,
    fileType: 'text',
    size,
    text: utf8.trim(),
    summary: `Text document (${utf8.length} characters)`,
  };
}
