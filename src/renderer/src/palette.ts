/**
 * The fixed set of accent colors a project can pick from (SPEC §2:
 * no custom taxonomies — a swatch row, not a color wheel).
 * Values mirror the --palette-* tokens in styles/tokens.css.
 */
export const PROJECT_COLORS = [
  '#ff6b6b', // coral
  '#ff922b', // orange
  '#fcc419', // amber
  '#94d82d', // lime
  '#20c997', // teal
  '#22b8cf', // cyan
  '#339af0', // blue
  '#845ef7', // violet
  '#cc5de8', // grape
  '#f06595' // pink
] as const

export function randomProjectColor(): string {
  return PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)]
}
