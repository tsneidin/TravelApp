/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          bg: '#0b1220',
          panel: '#101a2e',
          card: '#16213a',
          card2: '#1b2946',
          line: '#253356',
          text: '#e6edf7',
          muted: '#8ea0bc',
          accent: '#22d3ee',
          accent2: '#2dd4bf',
          danger: '#f87171',
          ok: '#34d399',
          warn: '#fbbf24',
        },
      },
      borderRadius: {
        brand: '14px',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'ui-sans-serif', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};