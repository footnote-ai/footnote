/**
 * @description: Builds the repository-owned documentation site without replacing the React web artifact.
 * @footnote-scope: web
 * @footnote-module: WikiAstroConfig
 * @footnote-risk: medium - Incorrect output or base-path settings can hide the public documentation site.
 * @footnote-ethics: medium - Documentation routing must preserve the project's public authority and accessibility.
 */
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
    site: 'https://ai.jordanmakes.dev',
    base: '/wiki',
    output: 'static',
    outDir: './.astro-dist',
    trailingSlash: 'always',
    integrations: [
        starlight({
            title: 'Footnote Documentation',
            description:
                'Repository-owned documentation for the transparency-first Footnote AI framework.',
            // Staging supplies source Git dates so the no-.git Docker build
            // never falls back to an unverified timestamp.
            lastUpdated: true,
            sidebar: [
                {
                    label: 'Start here',
                    items: ['getting-started', 'philosophy', 'documentation'],
                },
                {
                    label: 'Understand Footnote',
                    items: [
                        'architecture',
                        'architecture/workflow',
                        'architecture/public-web-surfaces',
                        'architecture/canonical-response-footnote',
                        'architecture/context-integrations',
                    ],
                },
                {
                    label: 'Use and operate',
                    items: [
                        'deployment',
                        'auth',
                        'architecture/first-setup-flow',
                        'architecture/embedding',
                    ],
                },
                {
                    label: 'Reference',
                    items: [
                        'api',
                        'architecture/tool-invocation-contract-v1',
                        'architecture/footnote-annotations',
                        'ci',
                    ],
                },
                {
                    label: 'Governance and history',
                    items: [
                        'security',
                        'licenses/mit',
                        'licenses/hippocratic',
                        'status',
                        'proposals',
                        'history',
                        {
                            label: 'Decisions',
                            items: [
                                { autogenerate: { directory: 'decisions' } },
                            ],
                        },
                    ],
                },
                {
                    label: 'Generated companion',
                    items: [
                        {
                            label: 'DeepWiki — generated code explainer',
                            link: 'https://deepwiki.com/footnote-ai/footnote',
                        },
                    ],
                },
            ],
        }),
    ],
});
