/** @type {import('tailwindcss').Config} */
module.exports = {
  content: {
    relative: true,
    files: [
      './apps/web/src/**/*.{js,ts,jsx,tsx,mdx}',
      './packages/ui/src/**/*.{js,ts,jsx,tsx,mdx}',
    ],
  },
  theme: {
    extend: {},
  },
  plugins: [],
}
