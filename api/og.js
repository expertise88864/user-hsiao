/**
 * GET /api/og?slug=<slug>           → 1200×630 PNG OG card for that article
 * GET /api/og?title=...&tag=...     → ad-hoc OG card with custom title + tag
 *
 * Uses @vercel/og (a thin wrapper around satori + resvg) to render JSX → PNG
 * at the edge. Output is identical visual style to the static cards in
 * /assets/og/*.png that _gen_og_images.py used to produce.
 *
 * Wired up in vercel.json: /assets/og/<slug>.png → /api/og?slug=<slug>
 * (only for articles that don't have a static .png override). Static cards
 * still take precedence because vercel.json `headers` for /assets/og/* sets
 * 1-year immutable — those continue to be served from disk.
 *
 * For new articles created via /api/admin/new, no static PNG exists, so
 * social-card preview hits the dynamic endpoint immediately.
 *
 * Caching: 1 hour at the edge, 1 day in browser. Bumping the cache forces
 * crawlers to re-fetch.
 */
import { ImageResponse } from '@vercel/og';
import { ghGetFile } from './admin/_github.js';

export const config = { runtime: 'edge' };

async function lookupTitle(slug) {
  const file = await ghGetFile('blog/blog-shared.js');
  if (!file) return null;
  const m = file.content.match(new RegExp(`slug\\s*:\\s*'${slug}'[^}]*?title\\s*:\\s*'([^']+)'[^}]*?(?:tag\\s*:\\s*'([^']*)')?`));
  if (!m) return null;
  return { title: m[1], tag: m[2] || '' };
}

export default async function handler(req) {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') || '';
  let title = url.searchParams.get('title');
  let tag = url.searchParams.get('tag') || '';

  if (slug && !title) {
    const meta = await lookupTitle(slug).catch(() => null);
    if (meta) { title = meta.title; tag = tag || meta.tag; }
  }
  if (!title) title = 'HsiaoEye · 蕭閔謙醫師 眼科筆記';
  if (!tag)   tag = '眼科衛教';

  // 1200x630 OG card. Theme matches HsiaoEye palette.
  const card = {
    type: 'div',
    props: {
      style: {
        height: '100%', width: '100%',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        padding: '64px 72px',
        background: 'linear-gradient(135deg, #faf7f2 0%, #f3e9d6 50%, #b8cfe3 100%)',
        position: 'relative',
        fontFamily: '"Noto Serif TC", "Inter", sans-serif',
      },
      children: [
        // Top row: brand mark + tag
        {
          type: 'div',
          props: {
            style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' },
            children: [
              {
                type: 'div',
                props: {
                  style: { display: 'flex', alignItems: 'center', gap: '14px' },
                  children: [
                    { type: 'div', props: {
                      style: {
                        width: '52px', height: '52px', borderRadius: '12px',
                        background: '#3a5a7c', color: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '28px', fontWeight: 700, fontFamily: 'Inter',
                      },
                      children: 'H',
                    }},
                    { type: 'div', props: {
                      style: { display: 'flex', flexDirection: 'column' },
                      children: [
                        { type: 'div', props: { style: { fontSize: '24px', fontWeight: 700, color: '#243b56', letterSpacing: '0.02em' }, children: 'HsiaoEye' } },
                        { type: 'div', props: { style: { fontSize: '14px', color: '#5e574e', marginTop: '2px' }, children: '蕭閔謙醫師 · 眼科筆記' } },
                      ],
                    }},
                  ],
                },
              },
              {
                type: 'div',
                props: {
                  style: {
                    background: '#243b56', color: '#fff',
                    padding: '8px 18px', borderRadius: '999px',
                    fontSize: '15px', fontWeight: 700, letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                  },
                  children: tag.slice(0, 24),
                },
              },
            ],
          },
        },
        // Title (large, multi-line)
        {
          type: 'div',
          props: {
            style: {
              display: 'flex', flexDirection: 'column',
              fontSize: title.length > 28 ? '64px' : '76px',
              fontWeight: 700, lineHeight: 1.18, color: '#0f172a',
              letterSpacing: '-0.01em',
              maxWidth: '1000px',
            },
            children: title,
          },
        },
        // Bottom strip: URL
        {
          type: 'div',
          props: {
            style: {
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              fontSize: '17px', color: '#5e574e',
              borderTop: '1px solid rgba(58,90,124,0.18)', paddingTop: '16px',
            },
            children: [
              { type: 'div', props: { style: { fontFamily: 'Inter' }, children: 'hsiao.chendermatologist.com' } },
              { type: 'div', props: { style: { fontFamily: 'Inter', color: '#3a5a7c', fontWeight: 600 }, children: slug ? `/blog/${slug}` : '/blog/' } },
            ],
          },
        },
      ],
    },
  };

  return new ImageResponse(card, {
    width: 1200,
    height: 630,
    headers: {
      'Cache-Control': 'public, max-age=86400, s-maxage=3600, stale-while-revalidate=604800',
    },
  });
}
