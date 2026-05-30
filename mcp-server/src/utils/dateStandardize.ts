/**
 * Genealogical date standardizer.
 * Converts free-form date strings into a canonical format.
 */
import {
  normalizeAccents,
  MONTHS,
  MONTH_NUM,
  MODIFIERS,
  QUARTER_WORDS,
  UNKNOWN_PHRASES,
  SPECIAL_PHRASES,
  ORDINAL_SUFFIXES,
  BC_WORDS,
  AD_WORDS,
  WFT_PATTERN,
} from './dateConstants.js';

// ---------- Token types ----------
interface Token {
  type: 'num' | 'str' | 'sym';
  value: string;
}

// ---------- Parsed date components ----------
interface DateParts {
  modifier?: string;
  day?: number;
  month?: string;       // 3-letter abbreviation
  year?: number;
  splitYear?: string;   // e.g. "24", "00"
  bc?: boolean;
  uncertain?: boolean;
  quarter?: number;     // 1-4 for quarter dates
}

// ---------- Tokenizer ----------
function tokenize(s: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/[0-9]/.test(ch)) {
      let num = '';
      while (i < s.length && /[0-9]/.test(s[i])) num += s[i++];
      tokens.push({ type: 'num', value: num });
    } else if (/[a-zA-Z]/.test(ch)) {
      let str = '';
      while (i < s.length && /[a-zA-Z]/.test(s[i])) str += s[i++];
      tokens.push({ type: 'str', value: str });
    } else if (ch === '/' || ch === '<' || ch === '>' || ch === '&') {
      tokens.push({ type: 'sym', value: ch });
      i++;
    } else {
      i++;
    }
  }
  return tokens;
}

// ---------- Format a single date ----------
function formatDate(d: DateParts): string {
  const parts: string[] = [];
  if (d.modifier) parts.push(d.modifier);
  if (d.day !== undefined) parts.push(String(d.day));
  if (d.month) parts.push(d.month);
  if (d.year !== undefined) {
    let yearStr = String(d.year);
    if (d.splitYear !== undefined) yearStr += '/' + d.splitYear;
    parts.push(yearStr);
  }
  if (d.bc) parts.push('BC');
  if (d.uncertain) parts.push('(?)');
  return parts.join(' ');
}

// ---------- Number-to-month ----------
function numToMonth(n: number): string | undefined {
  for (const [abbr, num] of MONTH_NUM) {
    if (num === n) return abbr;
  }
  return undefined;
}

// ---------- Pre-processing ----------
function preProcess(raw: string): { text: string; trailingParen: string; uncertain: boolean; orDates: string[] | null } {
  let text = raw;
  let trailingParen = '';
  let uncertain = false;
  const orDates: string[] | null = null;

  // Convert em-dashes/en-dashes to hyphens
  text = text.replace(/[\u2013\u2014]/g, '-');

  // Replace b.c. with bc (but not at start where it might mean "before circa")
  text = text.replace(/(?!^)b\.c\./gi, 'bc');

  // Extract trailing parenthetical
  const parenMatch = text.match(/^(.*?)\s*(\([^)]*\))\s*$/);
  if (parenMatch && parenMatch[1].trim().length > 0) {
    text = parenMatch[1].trim();
    trailingParen = parenMatch[2];
  }

  // Handle question mark
  if (text.includes('?')) {
    uncertain = true;
    text = text.replace(/\?/g, '');
  }

  // Detect YYYYMMDD (exactly 8 digits, standalone)
  const yyyymmddMatch = text.match(/^(\d{8})$/);
  if (yyyymmddMatch) {
    const digits = yyyymmddMatch[1];
    const y = parseInt(digits.substring(0, 4), 10);
    const m = parseInt(digits.substring(4, 6), 10);
    const d = parseInt(digits.substring(6, 8), 10);
    if (y >= 1000 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const mon = numToMonth(m);
      if (mon) {
        text = `${d} ${mon} ${y}`;
      }
    }
  }

  // Convert yyyy-mm-dd / yyyy/mm/dd / yyyy.mm.dd embedded dates
  text = text.replace(/(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})/g, (_match, y, m, d) => {
    const yy = parseInt(y, 10);
    const mm = parseInt(m, 10);
    const dd = parseInt(d, 10);
    if (yy >= 1000 && yy <= 2200 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      const mon = numToMonth(mm);
      if (mon) return `${dd} ${mon} ${yy}`;
    }
    return _match;
  });

  // Handle ambiguous mm-dd-yyyy / dd-mm-yyyy
  text = text.replace(/(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})/g, (_match, a, b, y) => {
    const aa = parseInt(a, 10);
    const bb = parseInt(b, 10);
    const yy = parseInt(y, 10);
    if (yy < 1000 || yy > 2200) return _match;

    const aIsDay = aa >= 1 && aa <= 31;
    const bIsDay = bb >= 1 && bb <= 31;
    const aIsMonth = aa >= 1 && aa <= 12;
    const bIsMonth = bb >= 1 && bb <= 12;

    if (aa > 12 && bIsMonth) {
      // dd-mm-yyyy
      const mon = numToMonth(bb);
      return mon ? `${aa} ${mon} ${yy}` : _match;
    } else if (bb > 12 && aIsMonth) {
      // mm-dd-yyyy
      const mon = numToMonth(aa);
      return mon ? `${bb} ${mon} ${yy}` : _match;
    } else if (aIsMonth && bIsDay && aa === bb) {
      // Same number, pick mm-dd-yyyy interpretation
      const mon = numToMonth(aa);
      return mon ? `${bb} ${mon} ${yy}` : _match;
    } else if (aIsMonth && bIsMonth && aIsDay && bIsDay && aa !== bb) {
      // Truly ambiguous
      const monA = numToMonth(aa);
      const monB = numToMonth(bb);
      if (monA && monB) {
        return `__OR__${bb} ${monA} ${yy}__OR__${aa} ${monB} ${yy}__OR__`;
      }
      return _match;
    }
    return _match;
  });

  // Convert dd-Mon-yyyy (dashes between day/month/year with alpha month) → spaces
  text = text.replace(/(\d{1,2})-([a-zA-Z]+)-(\d{4})/g, '$1 $2 $3');

  // Handle abbreviated year ranges: 1875-80 → 1875-1880 (BEFORE dash processing)
  text = text.replace(/(\d{4})-(\d{1,3})(?!\d)/g, (_match, base, suffix) => {
    const baseYear = parseInt(base, 10);
    const suffixNum = parseInt(suffix, 10);
    if (baseYear >= 1000 && baseYear <= 2200 && suffix.length < 4) {
      // Check it's not already a full year range converted above
      const suffixLen = suffix.length;
      const expanded = Math.floor(baseYear / Math.pow(10, suffixLen)) * Math.pow(10, suffixLen) + suffixNum;
      return `${base}-${expanded}`;
    }
    return _match;
  });

  // Handle dashes as range separators
  if (text.includes('-')) {
    const lowerText = text.toLowerCase();
    const hasBet = /\b(bet|btw|between)\b/.test(lowerText);
    const hasFrom = /\b(from|frm)\b/.test(lowerText);

    if (hasBet) {
      text = text.replace(/-/g, ' and ');
    } else if (hasFrom) {
      text = text.replace(/-/g, ' to ');
    } else {
      // Check if there's a dash that looks like a range separator (between date-like content)
      // Only convert dashes that are surrounded by spaces or date-like content
      text = 'from ' + text.replace(/-/g, ' to ');
    }
  }

  return { text: text.trim(), trailingParen, uncertain, orDates };
}

// ---------- Main parser ----------
function parseDateTokens(tokens: Token[], startIdx: number, endIdx: number): DateParts {
  const parts: DateParts = {};
  const pendingNums: number[] = [];
  let i = startIdx;

  while (i < endIdx) {
    const tok = tokens[i];

    if (tok.type === 'str') {
      const lower = normalizeAccents(tok.value).toLowerCase();

      // Check for month
      const monthAbbr = MONTHS.get(lower);
      if (monthAbbr) {
        parts.month = monthAbbr;
        // If we had a pending number <= 31, it's a day
        if (pendingNums.length === 1 && pendingNums[0] <= 31) {
          parts.day = pendingNums[0];
          pendingNums.length = 0;
        }
        i++;
        continue;
      }

      // Check for ordinal suffix after number
      if (ORDINAL_SUFFIXES.has(lower) && pendingNums.length > 0) {
        // Just ignore the suffix; the number is already stored
        i++;
        continue;
      }

      // Check for quarter word
      if (QUARTER_WORDS.has(lower)) {
        i++;
        continue;
      }

      // Check for BC
      if (BC_WORDS.has(lower)) {
        parts.bc = true;
        i++;
        continue;
      }

      // Check for AD
      if (AD_WORDS.has(lower)) {
        // Just discard
        i++;
        continue;
      }

      // Check for modifier
      const mod = MODIFIERS.get(lower);
      if (mod) {
        if (mod === 'and' || mod === 'or' || mod === 'From' || mod === 'To' || mod === 'Bet') {
          // These are handled at a higher level
          i++;
          continue;
        }
        if (parts.modifier) {
          // Double modifier — keep the first (primary)
          i++;
          continue;
        }
        parts.modifier = mod;
        i++;
        continue;
      }

      // Unknown string — skip
      i++;
      continue;
    }

    if (tok.type === 'num') {
      const num = parseInt(tok.value, 10);

      // Check if next token is an ordinal suffix
      if (i + 1 < endIdx && tokens[i + 1].type === 'str') {
        const nextLower = tokens[i + 1].value.toLowerCase();
        if (ORDINAL_SUFFIXES.has(nextLower)) {
          // Check if the token after ordinal is a quarter word
          if (i + 2 < endIdx && tokens[i + 2].type === 'str') {
            const qLower = tokens[i + 2].value.toLowerCase();
            if (QUARTER_WORDS.has(qLower) && num >= 1 && num <= 4) {
              // This is a quarter: "1st quarter"
              parts.day = undefined;
              parts.month = undefined;
              // Store quarter in a special way — we'll use day field as quarter marker
              pendingNums.push(num);
              // Mark this as quarter
              parts.quarter = num;
              i += 3; // skip num, ordinal, quarter word
              continue;
            }
          }
        }
      }

      // Check if next token is a quarter word directly (e.g., "1 quarter")
      if (i + 1 < endIdx && tokens[i + 1].type === 'str') {
        const nextLower = tokens[i + 1].value.toLowerCase();
        if (QUARTER_WORDS.has(nextLower) && num >= 1 && num <= 4) {
          parts.quarter = num;
          i += 2;
          continue;
        }
      }

      if (num >= 1000 && num <= 2200) {
        parts.year = num;
        // If there's a pending number and it could be a day
        if (pendingNums.length === 1 && pendingNums[0] >= 1 && pendingNums[0] <= 31) {
          parts.day = pendingNums[0];
        }
        pendingNums.length = 0;
        i++;

        // Check for split year: / followed by number
        if (i < endIdx && tokens[i].type === 'sym' && tokens[i].value === '/' &&
            i + 1 < endIdx && tokens[i + 1].type === 'num') {
          const suffixTok = tokens[i + 1];
          const suffixVal = parseInt(suffixTok.value, 10);

          if (num >= 1000 && num <= 1752) {
            // Valid split year range
            const nextYear = num + 1;
            const suffixLen = suffixTok.value.length;

            if (suffixLen <= 2) {
              // Verify suffix matches nextYear
              if (suffixLen === 1) {
                if ((nextYear % 10) === suffixVal) {
                  parts.splitYear = String(nextYear % 100).padStart(2, '0');
                  i += 2;
                } else {
                  // Invalid split year
                  parts.splitYear = undefined;
                }
              } else {
                if ((nextYear % 100) === suffixVal) {
                  parts.splitYear = suffixTok.value.padStart(2, '0');
                  i += 2;
                } else {
                  parts.splitYear = undefined;
                }
              }
            } else if (suffixLen === 3 || suffixLen === 4) {
              // e.g. 1699/1700
              if (suffixVal === nextYear) {
                parts.splitYear = String(nextYear % 100).padStart(2, '0');
                i += 2;
              }
            }

            // Check month validity for split years (only Jan-Mar)
            if (parts.splitYear !== undefined && parts.month) {
              const monthNum = MONTH_NUM.get(parts.month);
              if (monthNum && monthNum > 3) {
                parts.uncertain = true;
              }
            }
          } else {
            // Year > 1752, not valid split year — don't consume / and next num
            // Leave them for other processing
          }
        }
        continue;
      }

      // It's a smaller number
      if (parts.month && !parts.day && num >= 1 && num <= 31) {
        parts.day = num;
        i++;
        continue;
      }

      // Could be a day or a two-digit year (BC context)
      pendingNums.push(num);
      i++;
      continue;
    }

    if (tok.type === 'sym') {
      if (tok.value === '<' || tok.value === '>') {
        const mod = MODIFIERS.get(tok.value);
        if (mod && !parts.modifier) {
          parts.modifier = mod;
        }
      }
      i++;
      continue;
    }

    i++;
  }

  // Resolve pending numbers
  if (pendingNums.length > 0) {
    for (const num of pendingNums) {
      if (num >= 1000 && num <= 2200) {
        if (!parts.year) parts.year = num;
      } else if (parts.bc && num < 100) {
        if (!parts.year) parts.year = num;
      } else if (num >= 1 && num <= 31 && !parts.day) {
        // Store as potential day even without month (for range gap filling)
        parts.day = num;
      } else if (parts.quarter && num >= 1000 && num <= 2200) {
        parts.year = num;
      }
    }
  }

  return parts;
}

// Find all positions of a modifier keyword (checks both str and sym tokens)
function findAllModifier(tokens: Token[], keyword: string): number[] {
  const positions: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    let lookup: string | undefined;
    if (tok.type === 'str') {
      lookup = MODIFIERS.get(tok.value.toLowerCase());
    } else if (tok.type === 'sym') {
      lookup = MODIFIERS.get(tok.value);
    }
    if (lookup === keyword) positions.push(i);
  }
  return positions;
}

// ---------- Main export ----------
export function stdDate(raw: string): string {
  // 1. Empty/whitespace
  if (!raw || !raw.trim()) return '';

  const trimmed = raw.trim();
  const lowerTrimmed = trimmed.toLowerCase();

  // 2. Unknown phrases
  if (UNKNOWN_PHRASES.has(lowerTrimmed)) return '';

  // 3. Special phrases (check before other processing)
  const specialResult = SPECIAL_PHRASES.get(lowerTrimmed);
  if (specialResult) {
    return specialResult;
  }

  // Also check with trailing parenthetical stripped
  const specialParenMatch = trimmed.match(/^(.*?)\s*(\([^)]*\))\s*$/);
  if (specialParenMatch) {
    const base = specialParenMatch[1].trim().toLowerCase();
    const paren = specialParenMatch[2];
    const sp = SPECIAL_PHRASES.get(base);
    if (sp) return sp + ' ' + paren;
  }

  // 4. WFT patterns
  if (WFT_PATTERN.test(trimmed)) return '';

  // Handle input that is entirely parenthetical
  if (/^\([^)]*\)$/.test(trimmed)) {
    return trimmed;
  }

  // 5. Pre-process
  const { text, trailingParen, uncertain } = preProcess(trimmed);

  if (!text) return '';

  // Check for __OR__ pattern (ambiguous date)
  if (text.includes('__OR__')) {
    const orParts = text.match(/__OR__(.*?)__OR__(.*?)__OR__/);
    if (orParts) {
      const interp1 = orParts[1].trim();
      const interp2 = orParts[2].trim();

      // Parse each interpretation (they may have prefixes from pre-processing)
      let result = `${interp1} or ${interp2}`;
      if (trailingParen) result += ' ' + trailingParen;
      if (uncertain) result += ' (?)';
      return result;
    }
  }

  // Tokenize
  const allTokens = tokenize(normalizeAccents(text));

  if (allTokens.length === 0) return '';

  // Check for "Q" prefix for quarters (e.g., "Q1")
  if (allTokens.length >= 2 && allTokens[0].type === 'str' &&
      allTokens[0].value.toLowerCase() === 'q' && allTokens[1].type === 'num') {
    const qNum = parseInt(allTokens[1].value, 10);
    if (qNum >= 1 && qNum <= 4 && allTokens.length >= 3) {
      const yearTok = allTokens[2];
      if (yearTok.type === 'num') {
        const year = parseInt(yearTok.value, 10);
        if (year >= 1000 && year <= 2200) {
          let result = `Q${qNum} ${year}`;
          if (trailingParen) result += ' ' + trailingParen;
          return result;
        }
      }
    }
  }

  // Check for From/To pattern
  const fromPositions = findAllModifier(allTokens, 'From');
  const toPositions = findAllModifier(allTokens, 'To');
  const betPositions = findAllModifier(allTokens, 'Bet');
  const andPositions = findAllModifier(allTokens, 'and');

  // Check for Bet...and range
  if (betPositions.length > 0 && andPositions.length > 0) {
    const betIdx = betPositions[0];
    const andIdx = andPositions[0];
    if (andIdx > betIdx) {
      const date1 = parseDateTokens(allTokens, betIdx + 1, andIdx);
      const date2 = parseDateTokens(allTokens, andIdx + 1, allTokens.length);

      // Range gap filling
      fillRangeGaps(date1, date2);

      const d1str = formatDate(date1);
      const d2str = formatDate(date2);
      if (!date1.year && !date2.year) return '';
      let result = `Bet ${d1str} and ${d2str}`;
      if (trailingParen) result += ' ' + trailingParen;
      if (uncertain) result += ' (?)';
      return result;
    }
  }

  // Check for From...To range
  if (fromPositions.length > 0 && toPositions.length > 0) {
    const fromIdx = fromPositions[0];
    const toIdx = toPositions[0];
    if (toIdx > fromIdx) {
      const date1 = parseDateTokens(allTokens, fromIdx + 1, toIdx);
      const date2 = parseDateTokens(allTokens, toIdx + 1, allTokens.length);

      fillRangeGaps(date1, date2);

      const d1str = formatDate(date1);
      const d2str = formatDate(date2);
      if (!date1.year && !date2.year) return '';
      let result = `Bet ${d1str} and ${d2str}`;
      if (trailingParen) result += ' ' + trailingParen;
      if (uncertain) result += ' (?)';
      return result;
    }
  }

  // Standalone From → Aft
  if (fromPositions.length > 0 && toPositions.length === 0 && andPositions.length === 0) {
    const fromIdx = fromPositions[0];
    const date = parseDateTokens(allTokens, fromIdx + 1, allTokens.length);
    if (!date.year) return '';
    date.modifier = 'Aft';
    let result = formatDate(date);
    if (trailingParen) result += ' ' + trailingParen;
    if (uncertain) result += ' (?)';
    return result;
  }

  // Standalone To → Bef
  if (toPositions.length > 0 && fromPositions.length === 0) {
    const toIdx = toPositions[0];
    const date = parseDateTokens(allTokens, toIdx + 1, allTokens.length);
    if (!date.year) return '';
    date.modifier = 'Bef';
    let result = formatDate(date);
    if (trailingParen) result += ' ' + trailingParen;
    if (uncertain) result += ' (?)';
    return result;
  }

  // Single date parse
  const date = parseDateTokens(allTokens, 0, allTokens.length);

  // Check for quarter
  if (date.quarter) {
    const q = date.quarter;
    if (date.year) {
      let result = `Q${q} ${date.year}`;
      if (trailingParen) result += ' ' + trailingParen;
      return result;
    }
  }

  // Validate
  if (!date.year && !date.month && !date.day) {
    // Check if there was only a modifier
    return '';
  }

  if (!date.year) {
    // No year found
    return '';
  }

  // Two-digit year without BC context
  if (date.year < 100 && !date.bc) {
    return '';
  }

  if (uncertain) date.uncertain = true;

  let result = formatDate(date);
  if (trailingParen) result += ' ' + trailingParen;
  return result;
}


// ---------- Range gap filling ----------
function fillRangeGaps(date1: DateParts, date2: DateParts): void {
  // If date1 missing year but date2 has year, copy year
  if (!date1.year && date2.year) {
    date1.year = date2.year;
  }
  // If date1 missing month but date2 has month and date1 has day, copy month
  if (!date1.month && date2.month && date1.day) {
    date1.month = date2.month;
  }
  // If date1 has a pending number (stored nowhere yet) but no day, and date1 has no month...
  // This is handled in the parser when a number is left in pendingNums
}
