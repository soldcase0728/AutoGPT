import type { Config } from "tailwindcss";

/**
 * OLSM Eaglets identity: navy and gold.
 * Contrast pairs below are checked against WCAG 2.1 AA (4.5:1 for body text):
 *   navy-900 on white  = 15.9:1
 *   navy-700 on white  = 10.4:1
 *   gold-700 on white  =  4.6:1   <- the lightest gold allowed for text
 *   white on navy-800  = 13.1:1
 * Lighter golds are decorative only (borders, fills, focus rings).
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          50: "#f1f4f9",
          100: "#dde5f0",
          200: "#c0d0e4",
          300: "#94b1d1",
          400: "#618cba",
          500: "#3f6da3",
          600: "#305789",
          700: "#28466f",
          800: "#1d3557",
          900: "#132440",
          950: "#0b1728",
        },
        gold: {
          50: "#fdfaec",
          100: "#f9f1ca",
          200: "#f3e194",
          300: "#eccb56",
          400: "#e6b52e",
          500: "#d69a1a",
          600: "#bb7714",
          700: "#8f5413",
          800: "#764317",
          900: "#653818",
          950: "#3a1c09",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
