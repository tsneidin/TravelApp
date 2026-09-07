import React from 'react';
import { ExternalLink } from 'lucide-react';

/**
 * Checks if a string is or starts with a URL.
 */
export function isUrl(str?: string | null): boolean {
  if (!str) return false;
  const trimmed = str.trim();
  return /^(https?:\/\/|www\.)[^\s/$.?#].[^\s]*$/i.test(trimmed);
}

/**
 * Formats a URL string to ensure it has a valid protocol.
 */
export function formatUrl(url?: string | null): string {
  if (!url) return '';
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * Converts URLs within plain text into clickable external link elements.
 */
export function renderTextWithLinks(text?: string | null): React.ReactNode {
  if (!text) return null;
  // Match URLs: http://, https://, or www.
  const urlRegex = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s]|www\.[^\s<]+[^<.,:;"')\]\s])/gi;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = urlRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const matchedUrl = match[0];
    const href = formatUrl(matchedUrl);
    parts.push(
      <a
        key={match.index}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="link-inline"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          color: 'var(--accent)',
          textDecoration: 'underline',
          wordBreak: 'break-all',
          cursor: 'pointer',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <span>{matchedUrl}</span>
        <ExternalLink size={11} style={{ flexShrink: 0 }} />
      </a>,
    );
    lastIndex = match.index + matchedUrl.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}
