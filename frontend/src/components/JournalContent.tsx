import { useState } from 'react';
import { ExternalLink } from 'lucide-react';

interface JournalContentProps {
  content: string;
}

export function JournalContent({ content }: JournalContentProps) {
  const [viewingImage, setViewingImage] = useState<string | null>(null);

  if (!content) return null;

  // Parse lines and detect markdown images (![alt](url)), markdown links ([text](url)), and raw urls
  const lines = content.split('\n');

  const renderFormattedLine = (line: string, lineIdx: number) => {
    // Check if the entire line is a markdown image
    const imgRegex = /!\[(.*?)\]\((.*?)\)/g;
    const images: { alt: string; url: string }[] = [];
    let match: RegExpExecArray | null;

    while ((match = imgRegex.exec(line)) !== null) {
      images.push({ alt: match[1], url: match[2] });
    }

    if (images.length > 0 && line.trim().startsWith('![')) {
      return (
        <div key={lineIdx} style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', margin: '6px 0' }}>
          {images.map((img, imgIdx) => (
            <div
              key={imgIdx}
              style={{
                borderRadius: '8px',
                overflow: 'hidden',
                border: '1px solid var(--border)',
                background: 'var(--surface-hover)',
                maxWidth: '220px',
                cursor: 'zoom-in',
              }}
              onClick={() => setViewingImage(img.url)}
              title={img.alt || 'Click to view full size'}
            >
              <img
                src={img.url}
                alt={img.alt || 'Journal photo'}
                loading="lazy"
                style={{ display: 'block', width: '100%', maxHeight: '160px', objectFit: 'cover' }}
              />
              {img.alt && img.alt !== 'photo' && (
                <div className="small muted" style={{ padding: '4px 8px', fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {img.alt}
                </div>
              )}
            </div>
          ))}
        </div>
      );
    }

    // Split line by links and tokens
    // Matches [text](url) OR raw url
    const tokenRegex = /(\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/api\/[^\s)]+)\))|(https?:\/\/[^\s]+)/g;
    const parts: (string | JSX.Element)[] = [];
    let lastIndex = 0;
    let tokenMatch: RegExpExecArray | null;

    while ((tokenMatch = tokenRegex.exec(line)) !== null) {
      if (tokenMatch.index > lastIndex) {
        parts.push(line.slice(lastIndex, tokenMatch.index));
      }

      if (tokenMatch[1]) {
        // [text](url)
        const text = tokenMatch[2];
        const url = tokenMatch[3];
        parts.push(
          <a
            key={tokenMatch.index}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="journal-link"
            style={{ color: 'var(--accent)', textDecoration: 'underline', display: 'inline-flex', alignItems: 'center', gap: 2 }}
            onClick={(e) => e.stopPropagation()}
          >
            <span>{text}</span>
            <ExternalLink size={11} />
          </a>
        );
      } else if (tokenMatch[4]) {
        // raw url
        const url = tokenMatch[4];
        parts.push(
          <a
            key={tokenMatch.index}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="journal-link"
            style={{ color: 'var(--accent)', textDecoration: 'underline', display: 'inline-flex', alignItems: 'center', gap: 2 }}
            onClick={(e) => e.stopPropagation()}
          >
            <span>{url}</span>
            <ExternalLink size={11} />
          </a>
        );
      }

      lastIndex = tokenRegex.lastIndex;
    }

    if (lastIndex < line.length) {
      parts.push(line.slice(lastIndex));
    }

    return (
      <div key={lineIdx} style={{ minHeight: '1.2em' }}>
        {parts.length > 0 ? parts : ' '}
      </div>
    );
  };

  return (
    <div className="journal-content-rendered">
      {lines.map((line, idx) => renderFormattedLine(line, idx))}

      {viewingImage && (
        <div
          className="photo-lightbox"
          role="dialog"
          aria-modal="true"
          onClick={() => setViewingImage(null)}
          style={{ zIndex: 9999 }}
        >
          <button type="button" className="photo-lightbox-backdrop" aria-label="Close" onClick={() => setViewingImage(null)} />
          <div className="photo-lightbox-content" onClick={(e) => e.stopPropagation()}>
            <img src={viewingImage} alt="Full view" style={{ maxWidth: '90vw', maxHeight: '85vh', objectFit: 'contain' }} />
            <div className="photo-lightbox-actions" style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <a className="btn sm" href={viewingImage} target="_blank" rel="noreferrer">
                Open original
              </a>
              <button type="button" className="btn sm primary" onClick={() => setViewingImage(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
