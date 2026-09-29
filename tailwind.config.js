const repoRoot = __dirname.replace(/\\/g, '/')

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    `${repoRoot}/apps/web/src/**/*.{js,ts,jsx,tsx,mdx}`,
    `${repoRoot}/packages/ui/src/**/*.{js,ts,jsx,tsx,mdx}`,
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
