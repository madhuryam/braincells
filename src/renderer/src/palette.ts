/**
 * The fixed set of accent colors a project can pick from (SPEC §2:
 * no custom taxonomies — a swatch row, not a color wheel).
 * Values mirror the --palette-* tokens in styles/tokens.css.
 */
export const PROJECT_COLORS = [
  '#9b1b3f', // ruby
  '#ba653e', // copper
  '#c09435', // topaz
  '#166532', // emerald
  '#0f5872', // sapphire
  '#223a72', // navy
  '#732a63', // plum
  '#6c002f9d' // ruby-rose
] as const

export function randomProjectColor(): string {
  return PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)]
}
