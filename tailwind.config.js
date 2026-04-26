import typography from '@tailwindcss/typography';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#0c0c0c',
          surface: '#161616',
          elevated: '#1f1f1f',
        },
        border: {
          DEFAULT: '#2a2a2a',
          focus: '#6366f1',
          subtle: '#1e1e1e',
        },
        text: {
          DEFAULT: '#f0f0f0',
          muted: '#a0a0a0',
          subtle: '#666666',
        },
        primary: {
          DEFAULT: '#6366f1',
          hover: '#818cf8',
          muted: '#312e81',
        },
        gold: '#d4a843',
        success: '#22c55e',
        warning: '#f59e0b',
        error: '#ef4444',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': '0.65rem',
      },
      animation: {
        'pulse-dot': 'pulseDot 1.5s ease-in-out infinite',
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
      },
      keyframes: {
        pulseDot: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.4', transform: 'scale(0.8)' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [typography],
};
