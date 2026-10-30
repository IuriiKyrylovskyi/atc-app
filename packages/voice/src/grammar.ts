/**
 * Release-1 phraseology grammar (Chevrotain), from ICAO Doc 4444 ch. 12 and
 * FAA JO 7110.65 wording. Input is the normaliser's word list (normalise.ts);
 * output is a list of spoken items, still in words and digits — transmission.ts
 * resolves callsigns and fixes and runs them through the command-line validation.
 *
 *   transmission := callsign? item (("and")? item)*
 *
 * | Item      | Accepted forms                                                                  |
 * |-----------|---------------------------------------------------------------------------------|
 * | altitude  | climb / descend [and maintain | maintain | to] LEVEL ; maintain LEVEL              |
 * | LEVEL     | flight level D D D ; D… thousand [D hundred] [feet] ; D… hundred [feet] ; D… [feet]   |
 * | heading   | [fly] heading D D D ; turn left / right heading D D D                           |
 * | turn      | turn left / right [by] D… degrees                                               |
 * | speed     | reduce / increase [speed] [to] SPEED ; speed D… [knots] ; maintain SPEED          |
 * | SPEED     | D… knots ; mach [point] D D                                                     |
 * | direct    | [proceed] direct [to] FIX (one word, or NATO letters)                           |
 * | squawk    | squawk D D D D                                                                  |
 * | own nav   | resume own navigation                                                           |
 * | approach  | cleared ils [approach] runway D D [left / right / center] [approach]            |
 *
 * The callsign is not part of the grammar: it is every word before the first
 * keyword, matched against the aircraft on frequency (transmission.ts).
 */
import { EmbeddedActionsParser, Lexer, createToken, type IToken, type TokenType } from 'chevrotain';

/** Any other word, including alphanumeric flight numbers ("8qk"); pure digits are `Num`. */
const Word = createToken({ name: 'Word', pattern: /\d*[a-z][a-z0-9]*/ });
const Num = createToken({ name: 'Num', pattern: /\d+/ });
const WhiteSpace = createToken({ name: 'WhiteSpace', pattern: /\s+/, group: Lexer.SKIPPED });

const keyword = (word: string) =>
  createToken({ name: word.charAt(0).toUpperCase() + word.slice(1), pattern: new RegExp(word), longer_alt: Word });

const Letter = createToken({
  name: 'Letter',
  pattern:
    /alpha|bravo|charlie|delta|echo|foxtrot|golf|hotel|india|juliett|kilo|lima|mike|november|oscar|papa|quebec|romeo|sierra|tango|uniform|victor|whiskey|xray|yankee|zulu/,
  longer_alt: Word,
});

const Climb = keyword('climb');
const Descend = keyword('descend');
const Maintain = keyword('maintain');
const And = keyword('and');
const To = keyword('to');
const Flight = keyword('flight');
const Level = keyword('level');
const Heading = keyword('heading');
const Fly = keyword('fly');
const Turn = keyword('turn');
const Left = keyword('left');
const Right = keyword('right');
const Center = keyword('center');
const Degrees = keyword('degrees');
const By = keyword('by');
const Speed = keyword('speed');
const Knots = keyword('knots');
const Reduce = keyword('reduce');
const Increase = keyword('increase');
const Mach = keyword('mach');
const Point = keyword('point');
const Proceed = keyword('proceed');
const Direct = keyword('direct');
const Squawk = keyword('squawk');
const Resume = keyword('resume');
const Own = keyword('own');
const Navigation = keyword('navigation');
const Cleared = keyword('cleared');
const Ils = keyword('ils');
const Approach = keyword('approach');
const Runway = keyword('runway');
const Thousand = keyword('thousand');
const Hundred = keyword('hundred');
const Feet = keyword('feet');

const KEYWORDS: TokenType[] = [
  Climb, Descend, Maintain, And, To, Flight, Level, Heading, Fly, Turn, Left, Right, Center, Degrees, By,
  Speed, Knots, Reduce, Increase, Mach, Point, Proceed, Direct, Squawk, Resume, Own, Navigation, Cleared,
  Ils, Approach, Runway, Thousand, Hundred, Feet,
];
// Keywords before Word (longer_alt), Word before Num so "8qk" stays one word.
const ALL_TOKENS: TokenType[] = [WhiteSpace, ...KEYWORDS, Letter, Word, Num];

export const phraseLexer = new Lexer(ALL_TOKENS);

/** A number as said: its digits plus the multipliers and unit that follow. */
export interface SpokenNumber {
  digits: string;
  /** "D… thousand [D hundred]": thousands, then hundreds. */
  thousand?: { hundreds?: string };
  hundred?: boolean;
  unit?: 'feet' | 'knots';
}

export type SpokenItem =
  | { kind: 'altitude'; direction?: 'climb' | 'descend'; flightLevel?: string; value?: SpokenNumber }
  | { kind: 'heading'; digits: string; turn?: 'left' | 'right' }
  | { kind: 'turn'; digits: string; direction: 'left' | 'right' }
  | { kind: 'speed'; knots?: SpokenNumber; mach?: string }
  | { kind: 'direct'; fix: string[] }
  | { kind: 'squawk'; digits: string }
  | { kind: 'resume_own_navigation' }
  | { kind: 'approach'; runway: string; side?: 'L' | 'R' | 'C' };

class PhraseParser extends EmbeddedActionsParser {
  constructor() {
    super(ALL_TOKENS, { maxLookahead: 3 });
    this.performSelfAnalysis();
  }

  /** Item list after the callsign. */
  public items = this.RULE('items', (): SpokenItem[] => {
    const out: SpokenItem[] = [this.SUBRULE(this.item)];
    this.MANY(() => {
      this.OPTION(() => this.CONSUME(And));
      out.push(this.SUBRULE2(this.item));
    });
    return out;
  });

  private item = this.RULE('item', (): SpokenItem =>
    this.OR([
      { ALT: () => this.SUBRULE(this.altitude) },
      { ALT: () => this.SUBRULE(this.maintain) },
      { ALT: () => this.SUBRULE(this.heading) },
      { ALT: () => this.SUBRULE(this.turn) },
      { ALT: () => this.SUBRULE(this.speed) },
      { ALT: () => this.SUBRULE(this.direct) },
      { ALT: () => this.SUBRULE(this.squawk) },
      { ALT: () => this.SUBRULE(this.ownNavigation) },
      { ALT: () => this.SUBRULE(this.approach) },
    ]),
  );

  private altitude = this.RULE('altitude', (): SpokenItem => {
    const direction = this.OR([
      { ALT: () => (this.CONSUME(Climb), 'climb' as const) },
      { ALT: () => (this.CONSUME(Descend), 'descend' as const) },
    ]);
    this.OPTION(() =>
      this.OR2([
        { ALT: () => (this.CONSUME(And), this.CONSUME(Maintain)) },
        { ALT: () => this.CONSUME2(Maintain) },
        { ALT: () => this.CONSUME(To) },
      ]),
    );
    return { kind: 'altitude', direction, ...this.SUBRULE(this.level) };
  });

  /** "maintain" + a level or a speed: the unit after the number decides. */
  private maintain = this.RULE('maintain', (): SpokenItem => {
    this.CONSUME(Maintain);
    return this.OR([
      { ALT: () => ({ kind: 'speed', mach: this.SUBRULE(this.mach) }) },
      {
        ALT: () => {
          const level = this.SUBRULE(this.level);
          return this.ACTION(() =>
            level.value?.unit === 'knots' ? { kind: 'speed', knots: level.value } : { kind: 'altitude', ...level },
          );
        },
      },
    ]);
  });

  private level = this.RULE('level', (): { flightLevel?: string; value?: SpokenNumber } =>
    this.OR([
      {
        ALT: () => {
          this.CONSUME(Flight);
          this.CONSUME(Level);
          return { flightLevel: this.SUBRULE(this.digits) };
        },
      },
      { ALT: () => ({ value: this.SUBRULE(this.number) }) },
    ]),
  );

  private number = this.RULE('number', (): SpokenNumber => {
    const n: SpokenNumber = { digits: this.SUBRULE(this.digits) };
    this.OPTION(() =>
      this.OR([
        {
          ALT: () => {
            this.CONSUME(Thousand);
            const t: { hundreds?: string } = {};
            this.OPTION2(() => {
              t.hundreds = this.SUBRULE2(this.digits);
              this.CONSUME(Hundred);
            });
            n.thousand = t;
          },
        },
        { ALT: () => (this.CONSUME2(Hundred), (n.hundred = true)) },
      ]),
    );
    this.OPTION3(() =>
      this.OR2([
        { ALT: () => (this.CONSUME(Feet), (n.unit = 'feet')) },
        { ALT: () => (this.CONSUME(Knots), (n.unit = 'knots')) },
      ]),
    );
    return n;
  });

  private heading = this.RULE('heading', (): SpokenItem => {
    this.OPTION(() => this.CONSUME(Fly));
    this.CONSUME(Heading);
    return { kind: 'heading', digits: this.SUBRULE(this.digits) };
  });

  private turn = this.RULE('turn', (): SpokenItem => {
    this.CONSUME(Turn);
    const direction = this.SUBRULE(this.side) as 'left' | 'right';
    return this.OR([
      {
        ALT: () => {
          this.CONSUME(Heading);
          return { kind: 'heading', digits: this.SUBRULE(this.digits), turn: direction };
        },
      },
      {
        ALT: () => {
          this.OPTION(() => this.CONSUME(By));
          const digits = this.SUBRULE2(this.digits);
          this.CONSUME(Degrees);
          return { kind: 'turn', digits, direction };
        },
      },
    ]);
  });

  private side = this.RULE('side', (): 'left' | 'right' =>
    this.OR([
      { ALT: () => (this.CONSUME(Left), 'left' as const) },
      { ALT: () => (this.CONSUME(Right), 'right' as const) },
    ]),
  );

  private speed = this.RULE('speed', (): SpokenItem =>
    this.OR([
      {
        ALT: () => {
          this.OR2([{ ALT: () => this.CONSUME(Reduce) }, { ALT: () => this.CONSUME(Increase) }]);
          this.OPTION(() => this.CONSUME(Speed));
          this.OPTION2(() => this.CONSUME(To));
          return this.OR3([
            { ALT: () => ({ kind: 'speed', mach: this.SUBRULE(this.mach) }) },
            { ALT: () => ({ kind: 'speed', knots: this.SUBRULE(this.number) }) },
          ]);
        },
      },
      {
        ALT: () => {
          this.CONSUME2(Speed);
          return { kind: 'speed', knots: this.SUBRULE2(this.number) };
        },
      },
      { ALT: () => ({ kind: 'speed', mach: this.SUBRULE2(this.mach) }) },
    ]),
  );

  private mach = this.RULE('mach', (): string => {
    this.CONSUME(Mach);
    this.OPTION(() => this.CONSUME(Point));
    return this.SUBRULE(this.digits);
  });

  private direct = this.RULE('direct', (): SpokenItem => {
    this.OPTION(() => this.CONSUME(Proceed));
    this.CONSUME(Direct);
    this.OPTION2(() => this.CONSUME(To));
    const fix: string[] = [];
    this.AT_LEAST_ONE(() => {
      const t = this.OR([{ ALT: () => this.CONSUME(Word) }, { ALT: () => this.CONSUME(Letter) }]);
      this.ACTION(() => fix.push(t.image));
    });
    return { kind: 'direct', fix };
  });

  private squawk = this.RULE('squawk', (): SpokenItem => {
    this.CONSUME(Squawk);
    return { kind: 'squawk', digits: this.SUBRULE(this.digits) };
  });

  private ownNavigation = this.RULE('ownNavigation', (): SpokenItem => {
    this.CONSUME(Resume);
    this.CONSUME(Own);
    this.CONSUME(Navigation);
    return { kind: 'resume_own_navigation' };
  });

  private approach = this.RULE('approach', (): SpokenItem => {
    this.CONSUME(Cleared);
    this.CONSUME(Ils);
    this.OPTION(() => this.CONSUME(Approach));
    this.CONSUME(Runway);
    const runway = this.SUBRULE(this.digits);
    const side = this.OPTION2(() =>
      this.OR([
        { ALT: () => (this.CONSUME(Left), 'L' as const) },
        { ALT: () => (this.CONSUME(Right), 'R' as const) },
        { ALT: () => (this.CONSUME(Center), 'C' as const) },
      ]),
    );
    this.OPTION3(() => this.CONSUME2(Approach));
    return { kind: 'approach', runway, ...(side ? { side } : {}) };
  });

  /** Digits said one by one or written as a numeral: "1 1 9 2", "1192", "11 92". */
  private digits = this.RULE('digits', (): string => {
    let s = '';
    this.AT_LEAST_ONE(() => (s += this.CONSUME(Num).image));
    return s;
  });
}

const parser = new PhraseParser();

const KEYWORD_SET = new Set<TokenType>(KEYWORDS);

/** Lexes a normalised word list. Never fails: the normaliser leaves only [a-z0-9]. */
export function lexWords(words: readonly string[]): IToken[] {
  return phraseLexer.tokenize(words.join(' ')).tokens;
}

/**
 * Words that may belong to a callsign: anything up to the first keyword.
 * "flight" counts as a callsign word unless "level" follows ("Frontier Flight 12").
 * "to" only follows a keyword ("descend to"), so before one it is a misheard
 * syllable of the operator name ("Dell to 1192" for "Delta 1192").
 */
export function callsignLength(tokens: readonly IToken[]): number {
  let n = 0;
  while (n < tokens.length) {
    const t = tokens[n]!.tokenType;
    if ((t === Flight && tokens[n + 1]?.tokenType !== Level) || (t === To && n > 0)) {
      n++;
      continue;
    }
    if (KEYWORD_SET.has(t)) break;
    n++;
  }
  return n;
}

export type ItemsResult = { ok: true; items: SpokenItem[] } | { ok: false; error: string };

export function parseItems(tokens: IToken[]): ItemsResult {
  if (tokens.length === 0) return { ok: false, error: 'No instruction' };
  parser.input = tokens;
  const items = parser.items();
  const err = parser.errors[0];
  if (err) {
    const at = err.token.image ? `"${err.token.image}"` : 'the end';
    return { ok: false, error: `Not phraseology at ${at}` };
  }
  return { ok: true, items };
}
