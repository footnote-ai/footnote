/// <reference path="./astro-virtual-modules.d.ts" />

/**
 * @description: Validates generated documentation metadata while Starlight reads canonical repository Markdown.
 * @footnote-scope: web
 * @footnote-module: WikiContentConfig
 * @footnote-risk: low - Invalid generated metadata should fail the documentation build rather than publish ambiguity.
 * @footnote-ethics: medium - Lifecycle labels help readers distinguish current guidance from proposals and history.
 */
import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

export const collections = {
    docs: defineCollection({
        loader: docsLoader(),
        schema: docsSchema({
            extend: z.object({
                lifecycle: z.enum(['current', 'proposal', 'historical']),
            }),
        }),
    }),
};
