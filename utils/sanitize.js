/**
 * Simple XSS text sanitiser — strips HTML tags and trims whitespace.
 * For rich content you'd use a library like DOMPurify on the server,
 * but for plain-text fields (chat messages, bios, post bodies) this is sufficient
 * alongside the global xss-clean middleware.
 */
const sanitizeText = (text) => {
  if (typeof text !== 'string') return '';
  return text
    .replace(/<[^>]*>/g, '') // strip HTML tags
    .replace(/[<>]/g, '')    // belt-and-suspenders
    .trim();
};

module.exports = { sanitizeText };
