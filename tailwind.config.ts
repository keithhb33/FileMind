import type { Config } from "tailwindcss";
import forms from "@tailwindcss/forms";

export default {
  content: ["./src/renderer/index.html", "./src/renderer/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"]
      },
      boxShadow: {
        soft: "0 18px 60px rgba(24, 35, 55, 0.12)"
      }
    }
  },
  plugins: [forms]
} satisfies Config;
