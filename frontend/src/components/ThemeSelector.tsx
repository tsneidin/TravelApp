import { useEffect, useRef, useState } from 'react';
import { Palette, Check, ChevronDown } from 'lucide-react';
import { THEMES, getSavedTheme, applyTheme, type ThemeId } from '../lib/theme';

interface ThemeSelectorProps {
  compact?: boolean;
  className?: string;
}

export function ThemeSelector({ compact = false, className = '' }: ThemeSelectorProps) {
  const [currentTheme, setCurrentTheme] = useState<ThemeId>(getSavedTheme);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleThemeChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ theme: ThemeId }>;
      if (customEvent.detail?.theme) {
        setCurrentTheme(customEvent.detail.theme);
      }
    };
    window.addEventListener('travelapp:theme-changed', handleThemeChange);
    return () => window.removeEventListener('travelapp:theme-changed', handleThemeChange);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const activeThemeInfo = THEMES.find((t) => t.id === currentTheme) || THEMES[0];

  const handleSelectTheme = (id: ThemeId) => {
    applyTheme(id);
    setCurrentTheme(id);
    setIsOpen(false);
  };

  return (
    <div className={`theme-selector-container ${className}`} ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className={`theme-selector-btn ${compact ? 'compact' : ''}`}
        onClick={() => setIsOpen((prev) => !prev)}
        title={`Theme: ${activeThemeInfo.name} — Click to choose a theme`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <Palette size={15} style={{ color: activeThemeInfo.primaryColor }} />
        <span className="theme-current-name">{activeThemeInfo.name}</span>
        <div className="theme-color-dots" style={{ display: 'flex', gap: 3, alignItems: 'center', marginLeft: 2 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: activeThemeInfo.primaryColor,
              boxShadow: `0 0 6px ${activeThemeInfo.primaryColor}88`,
            }}
          />
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: activeThemeInfo.secondaryColor,
            }}
          />
        </div>
        <ChevronDown size={13} style={{ opacity: 0.7, marginLeft: 2 }} />
      </button>

      {isOpen && (
        <div className="theme-dropdown-menu" role="listbox">
          <div className="theme-dropdown-header">
            <span>Select Brand Theme</span>
          </div>
          <div className="theme-options-list">
            {THEMES.map((theme) => {
              const isSelected = theme.id === currentTheme;
              return (
                <button
                  key={theme.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`theme-option-item ${isSelected ? 'active' : ''}`}
                  onClick={() => handleSelectTheme(theme.id)}
                >
                  <div className="theme-option-swatch">
                    <span
                      style={{
                        backgroundColor: theme.primaryColor,
                        boxShadow: isSelected ? `0 0 8px ${theme.primaryColor}99` : 'none',
                      }}
                    />
                    <span style={{ backgroundColor: theme.secondaryColor }} />
                  </div>
                  <div className="theme-option-info">
                    <div className="theme-option-name">{theme.name}</div>
                    <div className="theme-option-tagline">{theme.tagline}</div>
                  </div>
                  {isSelected && (
                    <div className="theme-option-check">
                      <Check size={14} style={{ color: theme.primaryColor }} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
