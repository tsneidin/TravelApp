import { describe, expect, it } from 'vitest';
import {
  unescapeQuotedPrintable,
  decodeMimeWords,
  stripHtmlToText,
  parseEmlContent,
  extractDocumentText,
} from '../src/services/fileParser.js';

describe('fileParser service', () => {
  describe('unescapeQuotedPrintable', () => {
    it('decodes hex characters and handles soft line breaks', () => {
      const qp = 'Hello=20World=21=0D=0AThis is a long line=\r\n wrapped across lines.';
      const res = unescapeQuotedPrintable(qp);
      expect(res).toContain('Hello World!');
      expect(res).toContain('This is a long line wrapped across lines.');
    });
  });

  describe('decodeMimeWords', () => {
    it('decodes base64 MIME words', () => {
      // "Flight Confirmation" in base64: RmxpZ2h0IENvbmZpcm1hdGlvbg==
      const raw = '=?UTF-8?B?RmxpZ2h0IENvbmZpcm1hdGlvbg==?=';
      expect(decodeMimeWords(raw)).toBe('Flight Confirmation');
    });

    it('decodes quoted-printable MIME words', () => {
      const raw = '=?utf-8?Q?Booking_Ref_=2312345?=';
      expect(decodeMimeWords(raw)).toBe('Booking Ref #12345');
    });
  });

  describe('stripHtmlToText', () => {
    it('converts basic HTML elements into readable multi-line text', () => {
      const html = `
        <html>
          <head><style>.bad{color:red;}</style></head>
          <body>
            <h1>Delta Air Lines</h1>
            <p>Flight <strong>DL 123</strong> to Paris CDG.<br/>Departure: 18:00</p>
            <table>
              <tr><td>Seat: 14B</td><td>Confirmation: &amp;XYZ99</td></tr>
            </table>
          </body>
        </html>
      `;
      const res = stripHtmlToText(html);
      expect(res).toContain('Delta Air Lines');
      expect(res).toContain('Flight DL 123 to Paris CDG.');
      expect(res).toContain('Departure: 18:00');
      expect(res).toContain('Confirmation: &XYZ99');
      expect(res).not.toContain('<style>');
      expect(res).not.toContain('<h1>');
    });
  });

  describe('parseEmlContent', () => {
    it('parses headers and plain text body', () => {
      const eml = [
        'From: reservations@hotel.com',
        'To: traveler@example.com',
        'Subject: Your Stay at Hotel Roma',
        'Date: Mon, 15 Jun 2026 10:00:00 +0000',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'Dear Guest,',
        'Your reservation #HR-98765 is confirmed for June 15 to June 18.',
      ].join('\r\n');

      const parsed = parseEmlContent(eml);
      expect(parsed.subject).toBe('Your Stay at Hotel Roma');
      expect(parsed.from).toBe('reservations@hotel.com');
      expect(parsed.body).toContain('reservation #HR-98765 is confirmed');
    });

    it('parses multipart MIME emails with HTML part fallback', () => {
      const boundary = '----=_Part_123';
      const eml = [
        'From: airline@example.com',
        'Subject: =?utf-8?B?RmxpZ2h0IENvbmZpcm1hdGlvbg==?=',
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/html; charset=utf-8',
        'Content-Transfer-Encoding: quoted-printable',
        '',
        '<h2>Flight DL456 Confirmed</h2><p>PNR: =20ABCDEF</p>',
        `--${boundary}--`,
      ].join('\r\n');

      const parsed = parseEmlContent(eml);
      expect(parsed.subject).toBe('Flight Confirmation');
      expect(parsed.body).toContain('Flight DL456 Confirmed');
      expect(parsed.body).toContain('PNR: ABCDEF');
    });
  });

  describe('extractDocumentText', () => {
    it('extracts plain text files', async () => {
      const file = {
        buffer: Buffer.from('Itinerary notes:\n- Day 1: Colosseum\n- Day 2: Vatican'),
        originalname: 'itinerary.txt',
        mimetype: 'text/plain',
      };
      const res = await extractDocumentText(file);
      expect(res.fileType).toBe('text');
      expect(res.text).toContain('Colosseum');
    });

    it('extracts .eml files', async () => {
      const eml = 'Subject: Tour booking\n\nTour voucher for Eiffel Tower at 10 AM';
      const file = {
        buffer: Buffer.from(eml),
        originalname: 'booking.eml',
        mimetype: 'message/rfc822',
      };
      const res = await extractDocumentText(file);
      expect(res.fileType).toBe('email');
      expect(res.text).toContain('Tour voucher for Eiffel Tower');
    });
  });
});

  describe('PDF extraction', () => {
    it('extracts text from a valid PDF buffer', async () => {
      const minimalPdf = Buffer.from(`%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >> endobj
4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
5 0 obj << /Length 44 >> stream
BT
/F1 12 Tf
72 712 Td
(Flight AF 007 to Rome) Tj
ET
endstream endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000261 00000 n 
0000000337 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
431
%%EOF`);
      const res = await extractDocumentText({
        buffer: minimalPdf,
        originalname: 'boarding-pass.pdf',
        mimetype: 'application/pdf',
      });
      expect(res.fileType).toBe('pdf');
      expect(res.text).toContain('Flight AF 007 to Rome');
      expect(res.metadata?.totalPages).toBe(1);
    });
  });
