/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        zegy: {
          50: "#f0fdf9",
          100: "#ccfbef",
          200: "#9af5df",
          300: "#5fe8cc",
          400: "#2dd4b4",
          500: "#14b89c",
          600: "#0d9480",
          700: "#0f7668",
          800: "#115e54",
          900: "#134e46",
          950: "#042f2b",
        },
        surface: {
          DEFAULT: "#0f1117",
          raised: "#161922",
          overlay: "#1c202d",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      borderRadius: {
        "2xl": "1rem",
      },
      animation: {
        "fade-in": "fadeIn 0.3s ease-out",
        "slide-up": "slideUp 0.3s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
