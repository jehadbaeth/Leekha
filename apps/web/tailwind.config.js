import containerQueries from '@tailwindcss/container-queries';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        felt: {
          950: '#0b3d2e',
          900: '#0f4c3a',
          800: '#146149',
        },
      },
    },
  },
  plugins: [containerQueries],
};
