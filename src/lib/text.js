// The mind replies with HTML in `messageText` (`<p>…</p><p>- Songjam</p>`), which
// rendered as literal tags in the bubble. We convert to plain text with newlines
// rather than injecting HTML: the reply is remote content, and dangerouslySetInnerHTML
// on it would be an XSS hole for the sake of two paragraph breaks.
const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

const looksLikeHtml = (value) => /<\/?(p|br|div|ul|ol|li|strong|em|b|i|a|h[1-6])\b[^>]*>/i.test(value);

export const messageToText = (value) => {
  const text = String(value ?? '');
  if (!looksLikeHtml(text)) return text;

  return text
    // Block-level tags become line breaks so paragraphs and lists stay readable.
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(p|div|h[1-6]|li|ul|ol)\s*>/gi, '\n')
    .replace(/<\s*li\b[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&[a-z#0-9]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};
