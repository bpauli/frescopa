// Pure helper for the Stage 3 Brief editor panel (ticket #33).

/**
 * Compose the "Add to chat" text from the brief's title and body as
 * "<title>\n\n<body>". Blank parts are dropped so there is no leading or
 * trailing blank line, and a wholly empty brief yields an empty string. Pure.
 * @param {string} title
 * @param {string} body
 * @returns {string}
 */
export function composeChatText(title, body) {
  const t = (title || '').trim();
  const b = (body || '').trim();
  return [t, b].filter(Boolean).join('\n\n');
}
