import { describe, expect, it } from 'vitest';
import { matchesRecipient, parseEmailMessage } from '../src/services/emailMessage.js';

describe('booking email intake', () => {
  it('decodes multipart Gmail mail and accepts only the trips alias', async () => {
    const source = Buffer.from([
      'Message-ID: <booking-123@example.com>',
      'From: Vendor <confirmations@example.com>',
      'To: Todd <tneidinger+trips@gmail.com>',
      'Subject: =?UTF-8?Q?Your_Napoli_booking_=E2=82=AC39=2C98?=',
      'MIME-Version: 1.0',
      'Content-Type: multipart/alternative; boundary="booking"',
      '',
      '--booking',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Booking JJIWYJ. Total: =E2=82=AC39,98',
      '--booking',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>Booking JJIWYJ</p>',
      '--booking--',
      '',
    ].join('\r\n'));

    const parsed = await parseEmailMessage(source);
    expect(parsed.messageId).toBe('<booking-123@example.com>');
    expect(parsed.subject).toContain('€39,98');
    expect(parsed.bodyText).toContain('€39,98');
    expect(parsed.bodyText).not.toContain('--booking');
    expect(matchesRecipient(parsed, 'tneidinger+trips@gmail.com')).toBe(true);
    expect(matchesRecipient(parsed, 'tneidinger@gmail.com')).toBe(false);
  });

  it('handles HTML-only mail and a delivery alias header', async () => {
    const source = Buffer.from([
      'From: bookings@example.com',
      'To: undisclosed-recipients:;',
      'Delivered-To: tneidinger+trips@gmail.com',
      'Subject: Hotel confirmation',
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>Hotel reservation confirmed</p>',
    ].join('\r\n'));

    const parsed = await parseEmailMessage(source);
    expect(parsed.bodyText).toContain('Hotel reservation confirmed');
    expect(matchesRecipient(parsed, 'tneidinger+trips@gmail.com')).toBe(true);
    expect((await parseEmailMessage(source)).messageId).toBe(parsed.messageId);
  });
});
