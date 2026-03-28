/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        temperature: {
          DEFAULT: '#ef4444',
          light: '#fca5a5',
          dark: '#b91c1c',
        },
        humidity: {
          DEFAULT: '#3b82f6',
          light: '#93c5fd',
          dark: '#1e40af',
        },
        co2: {
          DEFAULT: '#10b981',
          light: '#6ee7b7',
          dark: '#047857',
        },
      },
    },
  },
  plugins: [],
}
