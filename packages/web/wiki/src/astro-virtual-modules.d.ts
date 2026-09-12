/**
 * @description: Supplies the small virtual-module declaration needed by repository-wide review tooling.
 * @footnote-scope: utility
 * @footnote-module: AstroVirtualModules
 * @footnote-risk: low - This declaration only supports static type analysis outside Astro's generated project types.
 * @footnote-ethics: low - Type-only build support has no user-facing behavior.
 */
declare module 'astro:content' {
    export function defineCollection<TConfig>(config: TConfig): unknown;
}
