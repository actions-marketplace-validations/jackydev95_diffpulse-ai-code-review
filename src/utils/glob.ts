/**
 * Converts a glob pattern (`*`, `**`, `?`) into a RegExp for POSIX-style repo paths.
 */
export function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  let regex = '^';
  let i = 0;

  while (i < normalized.length) {
    const ch = normalized[i];

    if (ch === '*') {
      if (normalized[i + 1] === '*') {
        // Consume `**/` as zero or more directory segments, or `**` as anything.
        if (normalized[i + 2] === '/') {
          regex += '(?:.*/)?';
          i += 3;
        } else {
          regex += '.*';
          i += 2;
        }
      } else {
        regex += '[^/]*';
        i += 1;
      }
    } else if (ch === '?') {
      regex += '[^/]';
      i += 1;
    } else if ('\\^$.|+()[]{}'.includes(ch)) {
      regex += `\\${ch}`;
      i += 1;
    } else {
      regex += ch;
      i += 1;
    }
  }

  regex += '$';
  return new RegExp(regex);
}

/**
 * Checks whether a relative file path matches at least one glob pattern.
 */
export function matchesAnyGlob(filePath: string, patterns: string[]): boolean {
  if (patterns.length === 0) {
    return false;
  }
  const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  return patterns.some((pattern) => {
    const trimmed = pattern.trim();
    if (!trimmed) {
      return false;
    }
    return globToRegExp(trimmed).test(normalizedPath);
  });
}

/**
 * Parses a comma- or newline-separated pattern string into trimmed entries.
 */
export function parsePatternList(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
