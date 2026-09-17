import { defineCollections, defineConfig, frontmatterSchema } from "fumadocs-mdx/config";
import { z } from "zod";

export const blog = defineCollections({
  type: "doc",
  dir: "content/blog",
  files: ["**/*.mdx"],
  schema: frontmatterSchema.extend({
    author: z.string(),
    date: z.string(),
    category: z.enum(["product", "workflow", "security", "install"]),
    draft: z.boolean().optional(),
  }),
});

/**
 * Customer stories are a first-class collection so a real write-up can ship
 * without inventing a second content system. Nothing in this folder is
 * published unless `published` is true.
 */
export const customers = defineCollections({
  type: "doc",
  dir: "content/customers",
  files: ["**/[!_]*.mdx"],
  schema: frontmatterSchema.extend({
    company: z.string(),
    role: z.string().optional(),
    industry: z.string().optional(),
    quote: z.string().optional(),
    published: z.boolean().default(false),
    date: z.string().optional(),
  }),
});

export default defineConfig();
