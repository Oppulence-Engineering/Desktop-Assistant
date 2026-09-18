import { blog, customers } from "@/.source";

export const blogCategories = ["product", "workflow", "security", "install"] as const;

export type BlogCategory = (typeof blogCategories)[number];

export type BlogPost = (typeof blog)[number];
export type CustomerStory = (typeof customers)[number];

function slugFromPath(filePath: string) {
  return filePath.replace(/\.mdx?$/, "");
}

function isPublicFile(filePath: string) {
  return !filePath.startsWith("_");
}

/** Editorial posts shown on /blog. Drafts and underscore files stay off the public index. */
export function publishedBlogPosts() {
  return [...blog]
    .filter((post) => isPublicFile(post.info.path) && !post.draft)
    .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
}

export function publishedBlogPost(slug: string) {
  return publishedBlogPosts().find((post) => slugFromPath(post.info.path) === slug);
}

export function blogPostSlug(post: BlogPost) {
  return slugFromPath(post.info.path);
}

export function blogPostsInCategory(category: BlogCategory) {
  return publishedBlogPosts().filter((post) => post.category === category);
}

export function isBlogCategory(value: string): value is BlogCategory {
  return (blogCategories as readonly string[]).includes(value);
}

function customerCollection() {
  return (customers ?? []).filter((story) => isPublicFile(story.info.path));
}

/**
 * Slugs Next can prerender. Cache Components forbids an empty
 * generateStaticParams, so drafts stay in this list and the route 404s
 * until `published` is true.
 */
export function customerStaticParams() {
  const slugs = customerCollection().map((story) => slugFromPath(story.info.path));
  return (slugs.length > 0 ? slugs : ["__none__"]).map((slug) => ({ slug }));
}

/**
 * Only stories with `published: true` reach the public site. The collection
 * can hold drafts, including `_template.mdx`, without inventing customers.
 */
export function publishedCustomerStories() {
  return customerCollection().filter((story) => story.published);
}

export function publishedCustomerStory(slug: string) {
  return publishedCustomerStories().find((story) => slugFromPath(story.info.path) === slug);
}

export function customerStorySlug(story: CustomerStory) {
  return slugFromPath(story.info.path);
}

export function editorialBlogPaths() {
  return publishedBlogPosts().map((post) => `blog/${blogPostSlug(post)}`);
}

export function editorialCustomerPaths() {
  return publishedCustomerStories().map((story) => `customers/${customerStorySlug(story)}`);
}
