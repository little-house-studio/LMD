export type TokenKind =
  | 'string'
  | 'at'
  | 'lparen'
  | 'rparen'
  | 'lbrack'
  | 'rbrack'
  | 'arrow'
  | 'arrowLeft'
  | 'arrowCall'
  | 'arrowReturn'
  | 'dash'
  | 'pipe'
  | 'comma'
  | 'colon'
  | 'heading'
  | 'newline'
  | 'eof';

export type Token = {
  kind: TokenKind;
  value: string;
  start: number;
  end: number;
};

const OPEN_QUOTES = new Set(['"', '\u201c']);
const CLOSE_QUOTES = new Set(['"', '\u201d', '\u201c']);

export function lexLmdLang(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = source.length;

  const push = (kind: TokenKind, start: number, end: number, value = source.slice(start, end)) => {
    tokens.push({ kind, value, start, end });
  };

  while (i < n) {
    const ch = source[i]!;

    if (ch === '\r') {
      i += 1;
      continue;
    }

    if (ch === '\n') {
      push('newline', i, i + 1, '\n');
      i += 1;
      continue;
    }

    if (ch === ' ' || ch === '\t') {
      i += 1;
      continue;
    }

    if (ch === '<' && source.startsWith('<!--', i)) {
      const close = source.indexOf('-->', i + 4);
      i = close < 0 ? n : close + 3;
      continue;
    }

    if (ch === '#' && (tokens.length === 0 || tokens[tokens.length - 1]?.kind === 'newline')) {
      const start = i;
      while (i < n && source[i] !== '\n' && source[i] !== '\r') {
        i += 1;
      }
      const raw = source.slice(start + 1, i).trim();
      push('heading', start, i, raw);
      continue;
    }

    if (OPEN_QUOTES.has(ch)) {
      const start = i;
      i += 1;
      let value = '';
      while (i < n) {
        const cur = source[i]!;
        if (cur === '\\' && i + 1 < n) {
          const next = source[i + 1]!;
          value += next === 'n' ? '\n' : next;
          i += 2;
          continue;
        }
        if (CLOSE_QUOTES.has(cur)) {
          i += 1;
          break;
        }
        value += cur;
        i += 1;
      }
      tokens.push({ kind: 'string', value, start, end: i });
      continue;
    }

    if (ch === '@') {
      const start = i;
      i += 1;
      while (i < n && /[A-Za-z0-9_.-]/.test(source[i]!)) {
        i += 1;
      }
      push('at', start, i, source.slice(start + 1, i));
      continue;
    }

    if (ch === '>' && source[i + 1] === '>') {
      push('arrowCall', i, i + 2, '>>');
      i += 2;
      continue;
    }

    if (ch === '<' && source[i + 1] === '<') {
      push('arrowReturn', i, i + 2, '<<');
      i += 2;
      continue;
    }

    if (ch === '-' && source[i + 1] === '>') {
      push('arrow', i, i + 2, '->');
      i += 2;
      continue;
    }

    if (ch === '<' && source[i + 1] === '-') {
      push('arrowLeft', i, i + 2, '<-');
      i += 2;
      continue;
    }

    if (ch === '-' && source[i + 1] === '-') {
      push('dash', i, i + 2, '--');
      i += 2;
      continue;
    }

    if (ch === '(') {
      push('lparen', i, i + 1);
      i += 1;
      continue;
    }
    if (ch === ')') {
      push('rparen', i, i + 1);
      i += 1;
      continue;
    }
    if (ch === '[') {
      push('lbrack', i, i + 1);
      i += 1;
      continue;
    }
    if (ch === ']') {
      push('rbrack', i, i + 1);
      i += 1;
      continue;
    }
    if (ch === '|') {
      push('pipe', i, i + 1);
      i += 1;
      continue;
    }
    if (ch === ',') {
      push('comma', i, i + 1);
      i += 1;
      continue;
    }
    if (ch === ':') {
      push('colon', i, i + 1);
      i += 1;
      continue;
    }

    const start = i;
    while (i < n && !' \t\r\n()[]|,:"@#'.includes(source[i]!)) {
      i += 1;
    }
    if (i === start) {
      i += 1;
    }
    push('string', start, i, source.slice(start, i));
  }

  tokens.push({ kind: 'eof', value: '', start: n, end: n });
  return tokens;
}
