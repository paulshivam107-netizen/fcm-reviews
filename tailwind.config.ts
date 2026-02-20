import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        base: {
          950: "#08121A",
          900: "#0D1B26",
          800: "#142636",
        },
        accent: {
          500: "#B8F56A",
          400: "#C7FF80",
        },
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(255,255,255,0.04), 0 20px 40px rgba(2,6,23,0.35)",
      },
      backgroundImage: {
        "page-glow":
          "radial-gradient(circle at 20% -10%, rgba(143, 244, 109, 0.18), transparent 45%), radial-gradient(circle at 90% 10%, rgba(55, 126, 246, 0.16), transparent 40%)",
      },
    },
  },
  plugins: [],
};

export default config;
