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

  it('includes a forwarded original email attached as an eml', async () => {
    const original = [
      'From: Alaska Lodge <reservations@example.com>',
      'To: traveler@example.com',
      'Subject: TEST-AK-0917-02 confirmation',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Check-in: December 13, 2026 at 3 PM. Check-out: December 15, 2026 at 11 AM.',
    ].join('\r\n');
    const source = Buffer.from([
      'From: Traveler <traveler@example.com>',
      'To: tneidinger+trips@gmail.com',
      'Subject: Fwd: Alaska reservation',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="forward"',
      '',
      '--forward',
      'Content-Type: text/plain',
      '',
      'Please add this trip.',
      '--forward',
      'Content-Type: message/rfc822; name="original.eml"',
      'Content-Disposition: attachment; filename="original.eml"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(original).toString('base64'),
      '--forward--',
    ].join('\r\n'));
    const parsed = await parseEmailMessage(source);
    expect(parsed.bodyText).toContain('Please add this trip.');
    expect(parsed.bodyText).toContain('TEST-AK-0917-02');
    expect(parsed.bodyText).toContain('Check-out: December 15, 2026 at 11 AM');
    expect(matchesRecipient(parsed, 'tneidinger+trips@gmail.com')).toBe(true);
  });

  it('keeps an HTML receipt when the plain-text part contains only the forwarding note', async () => {
    const html = '<html><body><blockquote><h2>This is your receipt</h2><table><tr><td>Booking number</td><td>9000001234</td></tr><tr><td>Property name</td><td>Example Harbor Hotel</td></tr><tr><td>Check-in</td><td>Wednesday, February 10, 2027</td></tr><tr><td>Check-out</td><td>Friday, February 12, 2027</td></tr></table><p>Amount paid on Jan 5, 2027</p><b>&euro;&nbsp;123.45</b></blockquote></body></html>';
    const source = Buffer.from([
      'From: Traveler <traveler@example.com>',
      'To: tneidinger+trips@gmail.com',
      'Subject: Fwd: This is your receipt',
      'MIME-Version: 1.0',
      'Content-Type: multipart/alternative; boundary="receipt"',
      '',
      '--receipt',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Sent from my iPhone',
      '--receipt',
      'Content-Type: text/html; charset=utf-8',
      '',
      html,
      '--receipt--',
    ].join('\r\n'));
    const parsed = await parseEmailMessage(source);
    expect(parsed.bodyText).toContain('Booking number 9000001234');
    expect(parsed.bodyText).toContain('Example Harbor Hotel');
    expect(parsed.bodyText).toContain('Check-in Wednesday, February 10, 2027');
    expect(parsed.bodyText).toContain('€ 123.45');
  });
});
