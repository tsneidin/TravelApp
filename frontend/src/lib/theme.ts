export type ThemeId =
  | 'default'
  | 'homedepot'
  | 'lowes'
  | 'milwaukee'
  | 'amazon'
  | 'facebook'
  | 'americanairlines';

export interface ThemeInfo {
  id: ThemeId;
  name: string;
  brand: string;
  tagline: string;
  primaryColor: string;
  secondaryColor: string;
  bgColor: string;
  panelColor: string;
}

export const THEMES: ThemeInfo[] = [
  {
    id: 'default',
    name: 'Default',
    brand: 'Default',
    tagline: 'Cyber Slate & Cyan (Dark)',
    primaryColor: '#22d3ee',
    secondaryColor: '#2dd4bf',
    bgColor: '#0b1220',
    panelColor: '#101a2e',
  },
  {
    id: 'homedepot',
    name: 'Home Depot',
    brand: 'Home Depot',
    tagline: 'Safety Orange & Clean Workshop White',
    primaryColor: '#f96302',
    secondaryColor: '#e05500',
    bgColor: '#f4f5f7',
    panelColor: '#ffffff',
  },
  {
    id: 'lowes',
    name: "Lowe's",
    brand: "Lowe's",
    tagline: "Royal Navy Blue & Value Gold",
    primaryColor: '#004990',
    secondaryColor: '#ffc220',
    bgColor: '#f2f5fa',
    panelColor: '#ffffff',
  },
  {
    id: 'milwaukee',
    name: 'Milwaukee Tool',
    brand: 'Milwaukee Tool',
    tagline: 'Heavy-Duty Crimson & Carbon Black',
    primaryColor: '#db0010',
    secondaryColor: '#ff2a3a',
    bgColor: '#0a0b0d',
    panelColor: '#131418',
  },
  {
    id: 'amazon',
    name: 'Amazon',
    brand: 'Amazon',
    tagline: 'Squid Ink Navy & Smile Amber',
    primaryColor: '#ff9900',
    secondaryColor: '#007185',
    bgColor: '#eaeded',
    panelColor: '#ffffff',
  },
  {
    id: 'facebook',
    name: 'Facebook',
    brand: 'Facebook',
    tagline: 'Meta Blue & Clean Canvas',
    primaryColor: '#0866ff',
    secondaryColor: '#31a24c',
    bgColor: '#f0f2f5',
    panelColor: '#ffffff',
  },
  {
    id: 'americanairlines',
    name: 'American Airlines',
    brand: 'American Airlines',
    tagline: 'Admirals Club Navy, Sky Blue & Tail Red',
    primaryColor: '#0078d2',
    secondaryColor: '#c30019',
    bgColor: '#edf1f7',
    panelColor: '#ffffff',
  },
];

const STORAGE_KEY = 'travelapp_theme';

export function getSavedTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
    if (saved && THEMES.some((t) => t.id === saved)) {
      return saved;
    }
  } catch {}
  return 'default';
}

export function applyTheme(id: ThemeId): void {
  const validTheme = THEMES.some((t) => t.id === id) ? id : 'default';
  try {
    localStorage.setItem(STORAGE_KEY, validTheme);
  } catch {}
  document.documentElement.setAttribute('data-theme', validTheme);
  window.dispatchEvent(new CustomEvent('travelapp:theme-changed', { detail: { theme: validTheme } }));
}

// Initialize theme immediately on import
if (typeof document !== 'undefined') {
  const current = getSavedTheme();
  document.documentElement.setAttribute('data-theme', current);
}
