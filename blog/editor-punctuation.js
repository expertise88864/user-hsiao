// Plain author metadata uses the same Chinese punctuation rules as HTML saves.
// Values are text; literal HTML-looking text does not grant a code-block exemption.
const CN = '[\\u4e00-\\u9fff]';       // CJK Unified Ideographs
const FW_LP   = '（';  // （
const FW_RP   = '）';  // ）
const FW_COMM = '，';  // ，
const FW_SEMI = '；';  // ；
const FW_COLN = '：';  // ：
const FW_EXCL = '！';  // ！
const FW_QUES = '？';  // ？

export const metadataPunctuationRules = [
  [new RegExp(`\\(${CN}`, 'g'),                          (m) => FW_LP + m.slice(1)],
  [new RegExp(`(${CN})\\(`, 'g'),                        '$1' + FW_LP],
  [new RegExp(`(${CN})\\)`, 'g'),                        '$1' + FW_RP],
  [new RegExp(`\\)(${CN})`, 'g'),                        FW_RP + '$1'],
  [new RegExp(`(${CN}),(${CN})`, 'g'),                   '$1' + FW_COMM + '$2'],
  [new RegExp(`(${CN}),(\\s)`, 'g'),                     '$1' + FW_COMM + '$2'],
  [new RegExp(`(${CN}),([A-Za-z0-9])`, 'g'),             '$1' + FW_COMM + '$2'],
  [new RegExp(`([A-Za-z0-9]),(${CN})`, 'g'),             '$1' + FW_COMM + '$2'],
  [new RegExp(`([）」】]),(${CN})`, 'g'),    '$1' + FW_COMM + '$2'],
  [new RegExp(`(${CN});(${CN})`, 'g'),                   '$1' + FW_SEMI + '$2'],
  [new RegExp(`(${CN}):(${CN})`, 'g'),                   '$1' + FW_COLN + '$2'],
  [new RegExp(`(${CN}):(\\s|<|$)`, 'g'),                 '$1' + FW_COLN + '$2'],
  [new RegExp(`(${CN}):(?![/\\d])`, 'g'),                '$1' + FW_COLN],
  [new RegExp(`(${CN})!(${CN})`, 'g'),                   '$1' + FW_EXCL + '$2'],
  [new RegExp(`(${CN})!(\\s|<|$)`, 'g'),                 '$1' + FW_EXCL + '$2'],
  [new RegExp(`(${CN})\\?(${CN})`, 'g'),                 '$1' + FW_QUES + '$2'],
  [new RegExp(`(${CN})\\?(\\s|<|$)`, 'g'),               '$1' + FW_QUES + '$2'],
];


export function normalizeMetadataText(text) {
  if (!/[\u4e00-\u9fff]/.test(text)) return text;
  for (const [pattern, replacement] of metadataPunctuationRules) text = text.replace(pattern, replacement);
  // Python's Chinese-context numbered-heading rule is absent from the older
  // HTML-save port. Apply it to plain Chinese fields, without changing English.
  text = text.replace(/([\u4e00-\u9fff]\s*\d+):(\s|<|$)/g, '$1：$2');
  return text;
}
