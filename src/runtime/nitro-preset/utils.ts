/**
 * Parse a comma-separated list into an array of decoded strings.
 * @param value - The raw comma-separated string
 * @returns string[] - The array of parsed strings
 */
export function parseCommaSeparatedList(value: string | null | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((i) => decodeURIComponent(i.trim()))
    .filter(Boolean)
}
