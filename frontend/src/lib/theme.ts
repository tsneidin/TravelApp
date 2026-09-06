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
    tagline: 'Cyber Slate & Cyan',
    primaryColor: '#22d3ee',
    secondaryColor: '#2dd4bf',
    bgColor: '#0b1220',
    panelColor: '#101a2e',
  },
  {
    id: 'homedepot',
    name: 'Home Depot',
    brand: 'Home Depot',
    tagline: 'Signature Orange & Slate',
    primaryColor: '#f96302',
    secondaryColor: '#ff8533',
    bgColor: '#111518',
    panelColor: '#181f25',
  },
  {
    id: 'lowes',
    name: "Lowe's",
    brand: "Lowe's",
    tagline: "Royal Blue & Gold",
    primaryColor: '#004990',
    secondaryColor: '#ffc220',
    bgColor: '#091322',
    panelColor: '#0d1e38',
  },
  {
    id: 'milwaukee',
    name: 'Milwaukee Tool',
    brand: 'Milwaukee Tool',
    tagline: 'Heavy-Duty Crimson & Carbon',
    primaryColor: '#db0010',
    secondaryColor: '#ff3344',
    bgColor: '#101114',
    panelColor: '#17181d',
  },
  {
    id: 'amazon',
    name: 'Amazon',
    brand: 'Amazon',
    tagline: 'Squid Ink Navy & Smile Orange',
    primaryColor: '#ff9900',
    secondaryColor: '#00a8e1',
    bgColor: '#11171f',
    panelColor: '#19222e',
  },
  {
    id: 'facebook',
    name: 'Facebook',
    brand: 'Facebook',
    tagline: 'Meta Blue & Midnight Slate',
    primaryColor: '#0866ff',
    secondaryColor: '#45bd62',
    bgColor: '#141517',
    panelColor: '#1e1f23',
  },
  {
    id: 'americanairlines',
    name: 'American Airlines',
    brand: 'American Airlines',
    tagline: 'Sky Blue, Flag Red & Platinum',
    primaryColor: '#0078d2',
    secondaryColor: '#c30019',
    bgColor: '#0c1420',
    panelColor: '#132032',
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
