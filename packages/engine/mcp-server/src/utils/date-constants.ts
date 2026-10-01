/**
 * Constants for genealogical date standardization.
 * Month names (14 languages), modifier synonyms, accent normalization, and lookup tables.
 */

/** Strip diacritics using Unicode NFD decomposition. `ł`/`Ł` have no NFD
 *  decomposition, so they are folded explicitly: without it `około` tokenized as
 *  `oko` + `o` and never matched `okolo`. */
export function normalizeAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L');
}

/**
 * Maps lowercase accent-normalized month names/abbreviations to 3-letter English abbreviations.
 * Languages: English, Dutch, French, German, Spanish, Norwegian/Danish, Portuguese, Italian, Polish, Russian (transliterated).
 */
export const MONTHS: Map<string, string> = new Map([
  // English
  ['january', 'Jan'], ['february', 'Feb'], ['march', 'Mar'], ['april', 'Apr'],
  ['may', 'May'], ['june', 'Jun'], ['july', 'Jul'], ['august', 'Aug'],
  ['september', 'Sep'], ['october', 'Oct'], ['november', 'Nov'], ['december', 'Dec'],
  ['jan', 'Jan'], ['feb', 'Feb'], ['mar', 'Mar'], ['apr', 'Apr'],
  ['jun', 'Jun'], ['jul', 'Jul'], ['aug', 'Aug'], ['sep', 'Sep'],
  ['oct', 'Oct'], ['nov', 'Nov'], ['dec', 'Dec'],
  ['sept', 'Sep'],

  // Dutch
  ['januari', 'Jan'], ['februari', 'Feb'], ['maart', 'Mar'],
  ['mei', 'May'], ['juni', 'Jun'], ['juli', 'Jul'], ['augustus', 'Aug'],
  ['oktober', 'Oct'],
  // apr, nov, dec, sep same as English

  // French (accent-normalized)
  ['janvier', 'Jan'], ['fevrier', 'Feb'], ['mars', 'Mar'], ['avril', 'Apr'],
  ['mai', 'May'], ['juin', 'Jun'], ['juillet', 'Jul'], ['aout', 'Aug'],
  ['septembre', 'Sep'], ['octobre', 'Oct'], ['novembre', 'Nov'], ['decembre', 'Dec'],
  ['fev', 'Feb'], ['juil', 'Jul'],

  // German (accent-normalized)
  ['januar', 'Jan'], ['februar', 'Feb'], ['marz', 'Mar'],
  // april same as English, mai same as French
  // juni, juli same as Dutch
  ['dezember', 'Dec'],
  ['okt', 'Oct'], ['dez', 'Dec'],

  // Spanish
  ['enero', 'Jan'], ['febrero', 'Feb'], ['marzo', 'Mar'], ['abril', 'Apr'],
  ['mayo', 'May'], ['junio', 'Jun'], ['julio', 'Jul'], ['agosto', 'Aug'],
  ['septiembre', 'Sep'], ['octubre', 'Oct'], ['noviembre', 'Nov'], ['diciembre', 'Dec'],

  // Norwegian/Danish
  // januar, februar, mars, april, mai, juni, juli, august already covered
  ['desember', 'Dec'],

  // Portuguese (accent-normalized)
  ['janeiro', 'Jan'], ['fevereiro', 'Feb'], ['marco', 'Mar'],
  ['maio', 'May'], ['junho', 'Jun'], ['julho', 'Jul'],
  // agosto same as Spanish
  ['setembro', 'Sep'], ['outubro', 'Oct'], ['novembro', 'Nov'], ['dezembro', 'Dec'],

  // Italian
  ['gennaio', 'Jan'], ['febbraio', 'Feb'],
  // marzo same as Spanish
  ['aprile', 'Apr'], ['maggio', 'May'], ['giugno', 'Jun'], ['luglio', 'Jul'],
  // agosto same as Spanish
  ['settembre', 'Sep'], ['ottobre', 'Oct'],
  // novembre same as French
  ['dicembre', 'Dec'],

  // Polish (accent-normalized)
  ['styczen', 'Jan'], ['luty', 'Feb'], ['marzec', 'Mar'], ['kwiecien', 'Apr'],
  ['maj', 'May'], ['czerwiec', 'Jun'], ['lipiec', 'Jul'], ['sierpien', 'Aug'],
  ['wrzesien', 'Sep'], ['pazdziernik', 'Oct'], ['listopad', 'Nov'], ['grudzien', 'Dec'],

  // Russian (transliterated)
  ['yanvar', 'Jan'], ['fevral', 'Feb'], ['mart', 'Mar'], ['aprel', 'Apr'],
  ['iyun', 'Jun'], ['iyul', 'Jul'], ['avgust', 'Aug'],
  ['sentyabr', 'Sep'], ['oktyabr', 'Oct'], ['noyabr', 'Nov'], ['dekabr', 'Dec'],
  // Hungarian (accent-normalized). januar, februar, oktober, november and
  // december already resolve through other languages' entries.
  ['marcius', 'Mar'], ['aprilis', 'Apr'], ['majus', 'May'], ['junius', 'Jun'],
  ['julius', 'Jul'], ['augusztus', 'Aug'], ['szeptember', 'Sep'],
  ['febr', 'Feb'], ['marc', 'Mar'], ['szept', 'Sep'],

  // Czech (accent-normalized), nominative and genitive: a date writes the
  // genitive ("13. brezna 1784"). listopad is shared with Polish above.
  ['leden', 'Jan'], ['ledna', 'Jan'], ['unor', 'Feb'], ['unora', 'Feb'],
  ['brezen', 'Mar'], ['brezna', 'Mar'], ['duben', 'Apr'], ['dubna', 'Apr'],
  ['kveten', 'May'], ['kvetna', 'May'], ['cerven', 'Jun'], ['cervna', 'Jun'],
  ['cervenec', 'Jul'], ['cervence', 'Jul'], ['srpen', 'Aug'], ['srpna', 'Aug'],
  ['zari', 'Sep'], ['rijen', 'Oct'], ['rijna', 'Oct'], ['listopadu', 'Nov'],
  ['prosinec', 'Dec'], ['prosince', 'Dec'],

  // Spanish and Portuguese abbreviations
  ['ene', 'Jan'], ['abr', 'Apr'], ['ago', 'Aug'], ['dic', 'Dec'], ['set', 'Sep'],

  // Danish
  ['marts', 'Mar'],

  // Common abbreviations in languages above. Not Portuguese 'out' (October),
  // which is an English word. Not 'listopada' (Polish November, Croatian October).
  ['mrt', 'Mar'], ['janv', 'Jan'], ['fevr', 'Feb'], ['avr', 'Apr'],
  ['gen', 'Jan'], ['mag', 'May'], ['giu', 'Jun'], ['lug', 'Jul'], ['ott', 'Oct'],
]);

/** Maps 3-letter abbreviations to month numbers (1-12) */
export const MONTH_NUM: Map<string, number> = new Map([
  ['Jan', 1], ['Feb', 2], ['Mar', 3], ['Apr', 4], ['May', 5], ['Jun', 6],
  ['Jul', 7], ['Aug', 8], ['Sep', 9], ['Oct', 10], ['Nov', 11], ['Dec', 12],
]);

/** Days in each month, index 0-12 (index 0 unused). Feb=29 for leap year treatment. */
export const DAYS_IN_MONTH: number[] = [
  0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
];

/** Cumulative days before start of each month, index 0-12. */
export const MONTH_DAY_OFFSETS: number[] = [
  0, 0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335,
];

/** Maps lowercase modifier synonyms to canonical forms */
export const MODIFIERS: Map<string, string> = new Map([
  // Abt
  ['about', 'Abt'], ['approx', 'Abt'], ['approximately', 'Abt'],
  ['circa', 'Abt'], ['ca', 'Abt'], ['c', 'Abt'], ['cir', 'Abt'],
  ['abt', 'Abt'],
  // `~` is this project's own approximate-date spelling — simplified GedcomX
  // writes `~1845` (simplified-gedcomx-spec.md, and every skill's date table).
  // Without it the tokenizer dropped the tilde and an approximate year
  // standardized to an exact one. Symbolic, like `<`/`>` below.
  ['~', 'Abt'],
  // Non-English about
  ['vers', 'Abt'], ['omstreeks', 'Abt'], ['omstr', 'Abt'],
  ['omkring', 'Abt'], ['omk', 'Abt'],
  // German 'um', Polish 'okolo' (from 'około', see normalizeAccents)
  ['um', 'Abt'], ['okolo', 'Abt'],

  // Cal
  ['cal', 'Cal'], ['calculated', 'Cal'], ['calc', 'Cal'], ['calcd', 'Cal'],

  // Est
  ['est', 'Est'], ['estimated', 'Est'], ['estd', 'Est'],
  ['say', 'Est'], ['probably', 'Est'], ['maybe', 'Est'], ['prob', 'Est'],
  ['int', 'Est'], ['interpreted', 'Est'], ['ansl', 'Est'], ['anslat', 'Est'],

  // Bef
  ['bef', 'Bef'], ['before', 'Bef'], ['bfr', 'Bef'], ['by', 'Bef'],
  ['voor', 'Bef'], ['avant', 'Bef'], ['antes', 'Bef'],
  ['<', 'Bef'],

  // Aft
  ['aft', 'Aft'], ['after', 'Aft'], ['na', 'Aft'], ['ett', 'Aft'], ['etter', 'Aft'],
  ['>', 'Aft'],

  // Bet
  ['bet', 'Bet'], ['between', 'Bet'], ['btw', 'Bet'],

  // From / To (preserved as distinct)
  ['from', 'From'], ['frm', 'From'], ['van', 'From'], ['von', 'From'],
  ['to', 'To'], ['until', 'To'], ['tot', 'To'], ['bis', 'To'],

  // Conjunctions
  ['and', 'and'], ['&', 'and'], ['also', 'and'],
  ['or', 'or'],
]);

export const QUARTER_WORDS: Set<string> = new Set(['quarter', 'qtr', 'qrt', 'q']);

/** Words that carry no date meaning and parse as nothing, so the whole-input
 *  vocabulary check in stdDate accepts them. English `of`/`the`/`day`/`on`,
 *  Spanish/Portuguese `de`
 *  ("22 de abril de 1838"), Polish `r` (rok, "21.06.1827 r."), and weekday
 *  names. Deliberately NOT `da` ("from") or `do` ("until"): treating them as
 *  filler would turn `do 1850` into an exact 1850. */
export const FILLER_WORDS: Set<string> = new Set([
  'de', 'r',
  // English: "3rd of March 1850", "the 5th day of June 1850", "on 4 July 1776"
  'of', 'the', 'day', 'on',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'mon', 'tue', 'tues', 'wed', 'weds', 'thu', 'thur', 'thurs', 'fri', 'sat', 'sun',
]);

export const UNKNOWN_PHRASES: Set<string> = new Set([
  'unknown', 'date unknown', 'unk', 'unknow', 'not known',
  'unbekannt', 'unbek.', 'onbekend', 'inconnue',
]);

export const SPECIAL_PHRASES: Map<string, string> = new Map([
  ['in infancy', '(in infancy)'],
  ['died in infancy', '(in infancy)'],
  ['infant', '(in infancy)'],
  ['infancy', '(in infancy)'],
  ['young', '(young)'],
  ['died young', '(young)'],
  ['stillborn', '(stillborn)'],
]);

export const ORDINAL_SUFFIXES: Set<string> = new Set(['st', 'nd', 'rd', 'th']);

export const BC_WORDS: Set<string> = new Set(['bc', 'bce']);

export const AD_WORDS: Set<string> = new Set(['ad', 'ac', 'ce']);

export const WFT_PATTERN: RegExp = /wft/i;
