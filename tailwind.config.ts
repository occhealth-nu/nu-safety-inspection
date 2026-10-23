import type { Config } from "tailwindcss";

// สีหลักอ่านจาก CSS variables ซึ่งตั้งค่าจากตาราง app_settings (ผู้ดูแลปรับได้)
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "rgb(var(--brand) / <alpha-value>)",
          dark: "rgb(var(--brand-dark) / <alpha-value>)",
          soft: "rgb(var(--brand) / 0.1)",
        },
        ink: "rgb(var(--ink) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["var(--font-sarabun)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
