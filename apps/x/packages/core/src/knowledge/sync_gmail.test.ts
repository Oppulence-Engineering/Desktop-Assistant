import { describe, expect, it } from 'vitest';
import {
  inlineCidImages,
  sanitizeReplyBodyForGmailReply,
  stripGmailQuotedReplyHtml,
  stripGmailQuotedReplyText,
} from './sync_gmail.js';

describe('Gmail reply body sanitization', () => {
  it('strips Gmail quote attribution and older quoted text from plain text replies', () => {
    const body = [
      'Sounds good, thanks. I will send it over today.',
      '',
      'On Thu, 28 May 2026 at 23:45, PRAKHAR <prakhar9999pandey@gmail.com> wrote:',
      '> Can you share the final file?',
      '> Thanks',
    ].join('\n');

    expect(stripGmailQuotedReplyText(body)).toBe('Sounds good, thanks. I will send it over today.');
  });

  it('strips Gmail quote blocks from html replies', () => {
    const html = [
      '<p>Sounds good, thanks.</p>',
      '<div class="gmail_quote">',
      '<div dir="ltr" class="gmail_attr">On Thu, 28 May 2026 at 23:45, PRAKHAR wrote:<br></div>',
      '<blockquote>Older thread text</blockquote>',
      '</div>',
    ].join('');

    expect(stripGmailQuotedReplyHtml(html)).toBe('<p>Sounds good, thanks.</p>');
  });

  it('regenerates html from clean text if only the text boundary is detected', () => {
    const result = sanitizeReplyBodyForGmailReply(
      '<p>Sounds good, thanks.</p><p>Older thread text</p>',
      'Sounds good, thanks.\n\nOn Thu, 28 May 2026 at 23:45, PRAKHAR <prakhar9999pandey@gmail.com> wrote:\nOlder thread text',
    );

    expect(result.bodyText).toBe('Sounds good, thanks.');
    expect(result.bodyHtml).toBe('<p>Sounds good, thanks.</p>');
  });
});

/**
 * Inline images are embedded as base64 data URLs inside the persisted thread
 * snapshot, so every one is re-read and re-parsed on every load of that thread,
 * for as long as the snapshot lives. Unbounded, a real mailbox produced 110KB
 * average snapshots and a 103MB seven-day cache — almost entirely pictures.
 *
 * The budget is per message and spends smallest-first, which is what makes a
 * flat cap acceptable: logos and tracking pixels are a few KB and still render;
 * a pasted screenshot does not, and keeps its cid: reference instead.
 */
describe('inline image budget', () => {
  const IMAGE_MIME = 'image/png';

  function payloadWith(parts: Array<{ cid: string; attachmentId: string }>) {
    return {
      parts: parts.map((p) => ({
        mimeType: IMAGE_MIME,
        headers: [{ name: 'Content-ID', value: `<${p.cid}>` }],
        body: { attachmentId: p.attachmentId },
      })),
    };
  }

  /** A stub Gmail whose attachment bytes are sized per attachment id. */
  function clientReturning(sizes: Record<string, number>) {
    return {
      users: {
        messages: {
          attachments: {
            get: async ({ id }: { id: string }) => ({
              data: { data: 'A'.repeat(sizes[id] ?? 0) },
            }),
          },
        },
      },
    } as never;
  }

  it('inlines a small image', async () => {
    const html = '<img src="cid:logo">';
    const out = await inlineCidImages(
      clientReturning({ a1: 2_000 }),
      'm1',
      payloadWith([{ cid: 'logo', attachmentId: 'a1' }]),
      html,
    );
    expect(out).toContain(`data:${IMAGE_MIME};base64,`);
    expect(out).not.toContain('cid:logo');
  });

  it('leaves an oversized image as a cid reference', async () => {
    const html = '<img src="cid:screenshot">';
    const out = await inlineCidImages(
      clientReturning({ a1: 5 * 1024 * 1024 }),
      'm1',
      payloadWith([{ cid: 'screenshot', attachmentId: 'a1' }]),
      html,
    );
    // The regression this guards: a 5MB screenshot embedded into every future
    // read of the thread.
    expect(out).not.toContain('base64,AAAA');
    expect(out).toContain('cid:screenshot');
    expect(out.length).toBeLessThan(1_000);
  });

  it('spends the budget on the small images when a big one is present', async () => {
    const html = '<img src="cid:big"><img src="cid:small">';
    const out = await inlineCidImages(
      clientReturning({ big: 5 * 1024 * 1024, small: 1_000 }),
      'm1',
      payloadWith([
        { cid: 'big', attachmentId: 'big' },
        { cid: 'small', attachmentId: 'small' },
      ]),
      html,
    );
    // Smallest-first: the signature logo survives even though the screenshot
    // appeared first in the document.
    expect(out).not.toContain('cid:small');
    expect(out).toContain('cid:big');
  });

  it('caps total embedded bytes per message', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      cid: `img${i}`,
      attachmentId: `img${i}`,
    }));
    const sizes = Object.fromEntries(many.map((m) => [m.attachmentId, 20 * 1024]));
    const html = many.map((m) => `<img src="cid:${m.cid}">`).join('');

    const out = await inlineCidImages(clientReturning(sizes), 'm1', payloadWith(many), html);

    // 40 x 20KB would be 800KB in one snapshot; the cap is 128KB.
    expect(out.length).toBeLessThan(300 * 1024);
    expect(out).toContain('cid:img');
  });
});

/**
 * Content-Ids share prefixes constantly — Gmail hands out img1..img12 for a
 * signature block — and the rewrite was a bare substring replace, so `cid:img1`
 * also rewrote `cid:img10`. Every image from the tenth on rendered as the first
 * one. Surfaced by the budget test, which measured far more embedded bytes than
 * it had spent.
 */
describe('inline image cid matching', () => {
  it('does not rewrite a longer cid that starts with a shorter one', async () => {
    const client = {
      users: {
        messages: {
          attachments: {
            get: async ({ id }: { id: string }) => ({
              data: { data: id === 'a1' ? 'AAAA' : 'BBBB' },
            }),
          },
        },
      },
    } as never;
    const payload = {
      parts: [
        {
          mimeType: 'image/png',
          headers: [{ name: 'Content-ID', value: '<img1>' }],
          body: { attachmentId: 'a1' },
        },
        {
          mimeType: 'image/gif',
          headers: [{ name: 'Content-ID', value: '<img10>' }],
          body: { attachmentId: 'a10' },
        },
      ],
    };

    const out = await inlineCidImages(
      client,
      'm1',
      payload,
      '<img src="cid:img1"><img src="cid:img10">',
    );

    // Each cid resolves to its own attachment: img1 -> png/AAAA, img10 -> gif/BBBB.
    expect(out).toContain('data:image/png;base64,AAAA');
    expect(out).toContain('data:image/gif;base64,BBBB');
    expect(out).not.toContain('cid:img');
  });
});
