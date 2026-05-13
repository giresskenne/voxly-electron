/**
 * Lightweight stop-word based language detector.
 * Returns an ISO 639-1 code ("en", "fr", "es", "de", "pt", "it") or null when uncertain.
 * Requires at least 2 matched stop-words before committing to a language.
 */

const STOP_WORDS: Record<string, string[]> = {
  en: [
    "the", "is", "are", "was", "were", "have", "has", "had", "will", "would",
    "could", "should", "this", "that", "these", "those", "with", "from", "they",
    "their", "there", "here", "what", "which", "when", "where", "how", "who",
    "just", "also", "very", "not", "but", "and", "for", "you", "your", "our",
    "its", "been", "being", "some", "any", "more", "than", "then", "into",
  ],
  fr: [
    "le", "la", "les", "est", "sont", "était", "étaient", "avoir", "avait",
    "nous", "vous", "ils", "elles", "ce", "que", "qui", "dans", "avec", "pour",
    "par", "sur", "pas", "plus", "aussi", "mais", "donc", "une", "des", "du",
    "je", "tu", "il", "elle", "mon", "ton", "son", "nos", "vos", "ses",
    "très", "bien", "comme", "tout", "toute", "tous", "leur", "leurs",
    "de", "en", "un", "et", "ne", "au", "aux", "ceci", "cet", "cette", "ces",
    "français", "francais",
  ],
  es: [
    "el", "los", "una", "unas", "unos", "está", "están", "era", "eran",
    "yo", "tú", "él", "ella", "nosotros", "vosotros", "ellos", "ellas",
    "que", "con", "para", "por", "sin", "también", "pero", "muy", "más",
    "como", "todo", "toda", "todos", "sus", "del", "las", "una",
  ],
  de: [
    "der", "die", "das", "ein", "eine", "ist", "sind", "war", "waren",
    "ich", "sie", "wir", "ihr", "nicht", "auch", "aber", "mit", "und",
    "auf", "für", "von", "bei", "nach", "aus", "als", "wenn", "dann",
    "oder", "noch", "dem", "den", "des", "wird",
  ],
  pt: [
    "os", "as", "uma", "umas", "uns", "está", "estão", "era", "eram",
    "que", "com", "para", "por", "mas", "muito", "mais", "como", "todos",
    "suas", "seu", "seus", "nossa", "nos", "nas", "pelo", "pela",
  ],
  it: [
    "gli", "una", "uno", "delle", "degli", "degli", "è", "sono", "era",
    "io", "tu", "lui", "lei", "noi", "voi", "loro", "con", "per",
    "che", "chi", "come", "quando", "dove", "anche", "ma", "più",
    "tutto", "tutta", "tutti", "suo", "sua", "loro",
  ],
};

const MIN_MATCHES = 2;

export function detectLanguage(text: string): string | null {
  const normalized = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ");
  const words = new Set(normalized.split(/\s+/).filter(Boolean));

  let best: string | null = null;
  let bestCount = MIN_MATCHES - 1; // must beat this threshold

  for (const [lang, stopWords] of Object.entries(STOP_WORDS)) {
    const count = stopWords.filter((w) => words.has(w)).length;
    if (count > bestCount) {
      bestCount = count;
      best = lang;
    }
  }

  return best;
}

/**
 * Maps a whisper language code (e.g. "fr", "en", "fr-FR") to a simple ISO 639-1 code.
 */
export function normalizeToIso(lang: string): string {
  return lang.toLowerCase().split(/[-_]/)[0];
}
