/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'] },
      colors: {
        brand: { 50: '#eef6ff', 100: '#d9eaff', 200: '#bcdaff', 300: '#8ec3ff', 400: '#59a1ff', 500: '#337dff', 600: '#1b5ef5', 700: '#1449e1', 800: '#173cb6', 900: '#19378f' },
        ink: { 50: '#f7f8fa', 100: '#eef0f4', 200: '#dde1e8', 300: '#c2c8d3', 400: '#8f98a8', 500: '#677184', 600: '#4b5466', 700: '#363d4c', 800: '#222834', 900: '#151a23', 950: '#0c1017' },
      },
      boxShadow: { card: '0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06)' },
    },
  },
  plugins: [],
};
