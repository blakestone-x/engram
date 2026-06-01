/**
 * Porter stemmer (M.F. Porter, 1980) — reduces word variants to a common stem so
 * "running", "ran"-adjacent forms, "dispatches"/"dispatching" collapse together
 * for retrieval. Applied identically to indexed text and queries, so producing
 * non-words ("happi") is fine. Pure, dependency-free.
 *
 * Compact canonical implementation; well-known and widely verified.
 */

const step2list: Record<string, string> = {
  ational: "ate", tional: "tion", enci: "ence", anci: "ance", izer: "ize",
  bli: "ble", alli: "al", entli: "ent", eli: "e", ousli: "ous", ization: "ize",
  ation: "ate", ator: "ate", alism: "al", iveness: "ive", fulness: "ful",
  ousness: "ous", aliti: "al", iviti: "ive", biliti: "ble", logi: "log",
};

const step3list: Record<string, string> = {
  icate: "ic", ative: "", alize: "al", iciti: "ic", ical: "ic", ful: "", ness: "",
};

const c = "[^aeiou]";
const v = "[aeiouy]";
const C = `${c}[^aeiouy]*`;
const V = `${v}[aeiou]*`;

const mgr0 = new RegExp(`^(${C})?${V}${C}`);
const meq1 = new RegExp(`^(${C})?${V}${C}(${V})?$`);
const mgr1 = new RegExp(`^(${C})?${V}${C}${V}${C}`);
const s_v = new RegExp(`^(${C})?${v}`);

export function porterStem(w: string): string {
  if (w.length < 3) return w;
  let stem: string;
  let suffix: string;
  let re: RegExp;
  let re2: RegExp;
  let re3: RegExp;
  let re4: RegExp;
  let word = w;

  const firstch = word[0];
  if (firstch === "y") word = firstch.toUpperCase() + word.slice(1);

  // Step 1a
  re = /^(.+?)(ss|i)es$/;
  re2 = /^(.+?)([^s])s$/;
  if (re.test(word)) word = word.replace(re, "$1$2");
  else if (re2.test(word)) word = word.replace(re2, "$1$2");

  // Step 1b
  re = /^(.+?)eed$/;
  re2 = /^(.+?)(ed|ing)$/;
  if (re.test(word)) {
    const fp = re.exec(word) as RegExpExecArray;
    re = new RegExp(mgr0.source);
    if (re.test(fp[1] as string)) word = word.replace(/.$/, "");
  } else if (re2.test(word)) {
    const fp = re2.exec(word) as RegExpExecArray;
    stem = fp[1] as string;
    re2 = new RegExp(s_v.source);
    if (re2.test(stem)) {
      word = stem;
      re2 = /(at|bl|iz)$/;
      re3 = new RegExp("([^aeiouylsz])\\1$");
      re4 = new RegExp(`^${C}${v}[^aeiouwxy]$`);
      if (re2.test(word)) word = `${word}e`;
      else if (re3.test(word)) word = word.replace(/.$/, "");
      else if (re4.test(word)) word = `${word}e`;
    }
  }

  // Step 1c
  re = /^(.+?)y$/;
  if (re.test(word)) {
    const fp = re.exec(word) as RegExpExecArray;
    stem = fp[1] as string;
    re = new RegExp(s_v.source);
    if (re.test(stem)) word = `${stem}i`;
  }

  // Step 2
  re = /^(.+?)(ational|tional|enci|anci|izer|bli|alli|entli|eli|ousli|ization|ation|ator|alism|iveness|fulness|ousness|aliti|iviti|biliti|logi)$/;
  if (re.test(word)) {
    const fp = re.exec(word) as RegExpExecArray;
    stem = fp[1] as string;
    suffix = fp[2] as string;
    re = new RegExp(mgr0.source);
    if (re.test(stem)) word = stem + step2list[suffix];
  }

  // Step 3
  re = /^(.+?)(icate|ative|alize|iciti|ical|ful|ness)$/;
  if (re.test(word)) {
    const fp = re.exec(word) as RegExpExecArray;
    stem = fp[1] as string;
    suffix = fp[2] as string;
    re = new RegExp(mgr0.source);
    if (re.test(stem)) word = stem + step3list[suffix];
  }

  // Step 4
  re = /^(.+?)(al|ance|ence|er|ic|able|ible|ant|ement|ment|ent|ou|ism|ate|iti|ous|ive|ize)$/;
  re2 = /^(.+?)(s|t)(ion)$/;
  if (re.test(word)) {
    const fp = re.exec(word) as RegExpExecArray;
    stem = fp[1] as string;
    re = new RegExp(mgr1.source);
    if (re.test(stem)) word = stem;
  } else if (re2.test(word)) {
    const fp = re2.exec(word) as RegExpExecArray;
    stem = (fp[1] as string) + (fp[2] as string);
    re2 = new RegExp(mgr1.source);
    if (re2.test(stem)) word = stem;
  }

  // Step 5
  re = /^(.+?)e$/;
  if (re.test(word)) {
    const fp = re.exec(word) as RegExpExecArray;
    stem = fp[1] as string;
    re = new RegExp(mgr1.source);
    re2 = new RegExp(meq1.source);
    re3 = new RegExp(`^${C}${v}[^aeiouwxy]$`);
    if (re.test(stem) || (re2.test(stem) && !re3.test(stem))) word = stem;
  }

  re = /ll$/;
  re2 = new RegExp(mgr1.source);
  if (re.test(word) && re2.test(word)) word = word.replace(/.$/, "");

  if (firstch === "y") word = firstch.toLowerCase() + word.slice(1);
  return word;
}
