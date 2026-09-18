# Customer stories

This folder is the Fumadocs collection behind `/customers`.

Do not invent companies, quotes, logos, or outcomes.

To publish a story:

1. Copy `_template.mdx` to `{slug}.mdx`.
2. Fill only facts the customer approved.
3. Set `published: true`.
4. The index and `/customers/{slug}` pick it up on the next build.

Unpublished files stay on disk for drafting. They 404 on the public site.
