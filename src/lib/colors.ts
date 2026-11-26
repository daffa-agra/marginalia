/**
 * Book spine colours.
 *
 * One list, used by every path that creates a book, so a book added by upload,
 * by hand, or by import looks the same. These are data (a user picks one), not
 * design tokens, which is why they live here rather than in the stylesheet.
 */
export const SHELF_COLORS = [
  { value: '#b4552d', name: 'Rust' },
  { value: '#3f6f71', name: 'Teal' },
  { value: '#5b6d8f', name: 'Slate' },
  { value: '#8f5b6d', name: 'Mulberry' },
  { value: '#6d7a5b', name: 'Moss' },
  { value: '#a0703c', name: 'Ochre' },
  { value: '#704f8f', name: 'Iris' },
  { value: '#4f7a5c', name: 'Pine' },
];

export const DEFAULT_BOOK_COLOR = SHELF_COLORS[1].value;

/** A stable colour for an imported book, derived from its title. */
export function colorForTitle(title: string): string {
  let hash = 0;
  for (let i = 0; i < title.length; i++) hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  return SHELF_COLORS[hash % SHELF_COLORS.length].value;
}
