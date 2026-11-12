import { defineCollection, defineContentConfig, z } from '@nuxt/content';

/**
 * Obsah webu, který je delší než jedna obrazovka, žije v Markdownu:
 * use-case stránky a nápověda. Zbytek (hlavní stránka) je Vue.
 */
const faq = z
	.array(
		z.object({
			q: z.string(),
			a: z.string(),
		}),
	)
	.optional();

export default defineContentConfig({
	collections: {
		content: defineCollection({
			type: 'page',
			source: '**/*.md',
			schema: z.object({
				// 'use-case' | 'help' — rozhoduje o šabloně
				kind: z.string(),
				title: z.string(),
				description: z.string(),
				// use-case
				eyebrow: z.string().optional(),
				lede: z.string().optional(),
				shot: z.string().optional(),
				shotAlt: z.string().optional(),
				video: z.string().optional(),
				faq,
				related: z.array(z.string()).optional(),
				// nápověda
				group: z.string().optional(),
				order: z.number().optional(),
				updated: z.string().optional(),
			}),
		}),
	},
});
