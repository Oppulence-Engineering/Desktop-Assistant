export const dynamic = 'force-dynamic'

// Lazy-cached template fetch. We can't kick this off at module load because
// process.env.CHAT_WIDGET_HOST is undefined during `next build`'s page-data
// collection, which would crash module evaluation with an invalid URL.
let templatePromise: Promise<string> | null = null;

function loadTemplate(host: string): Promise<string> {
  if (!templatePromise) {
    templatePromise = fetch(`${host}/bootstrap.template.js`).then(res => res.text());
  }
  return templatePromise;
}

export async function GET() {
  const host = process.env.CHAT_WIDGET_HOST;
  if (!host) {
    console.error('CHAT_WIDGET_HOST is not set');
    return new Response('Server misconfigured', { status: 500 });
  }

  try {
    const template = await loadTemplate(host);

    const contents = template
      .replace('__CHAT_WIDGET_HOST__', host)
      .replace('__ROWBOAT_HOST__', process.env.ROWBOAT_HOST || '');

    return new Response(contents, {
      headers: {
        'Content-Type': 'application/javascript',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    console.error('Error serving bootstrap.js:', error);
    return new Response('Error loading script', { status: 500 });
  }
}
