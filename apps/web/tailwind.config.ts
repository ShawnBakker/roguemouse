import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // ── Core cream palette (ported from Meridian system) ──
        surface: {
          0: "var(--color-bg)",
          1: "var(--color-surface)",
          2: "var(--color-faint)",
          3: "var(--color-rule)",
          4: "var(--color-muted)",
        },
        ink: {
          DEFAULT: "var(--color-ink)",
          mid: "var(--color-muted)",
          dim: "var(--color-muted)",
          ghost: "var(--color-rule)",
        },

        // ── Roguemouse semantic ──
        positive: {
          DEFAULT: "var(--color-positive)",
          dim: "var(--color-positive-dim)",
          border: "var(--color-positive-border)",
        },
        caution: {
          DEFAULT: "var(--color-caution)",
          dim: "var(--color-caution-dim)",
          border: "var(--color-caution-border)",
        },
        anomaly: {
          DEFAULT: "var(--color-anomaly)",
          dim: "var(--color-anomaly-dim)",
          border: "var(--color-anomaly-border)",
        },

        // ── Roguemouse voice accents ──
        voice: {
          risk: {
            DEFAULT: "var(--color-voice-risk)",
            dim: "var(--color-voice-risk-dim)",
            border: "var(--color-voice-risk-border)",
          },
          ops: {
            DEFAULT: "var(--color-voice-ops)",
            dim: "var(--color-voice-ops-dim)",
            border: "var(--color-voice-ops-border)",
          },
          synth: {
            DEFAULT: "var(--color-voice-synth)",
            dim: "var(--color-voice-synth-dim)",
            border: "var(--color-voice-synth-border)",
          },
        },

        // ── shadcn tokens (resolve to Meridian via globals.css mapping;
        //    no hsl() wrapper since Meridian tokens are hex/rgba) ──
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
      },

      fontFamily: {
        sans: ["Trebuchet MS", "Lucida Grande", "Lucida Sans Unicode", "sans-serif"],
        mono: ["Courier New", "Courier", "monospace"],
      },

      borderColor: {
        DEFAULT: "var(--color-rule)",
        mid: "var(--color-rule)",
        strong: "var(--color-ink)",
      },

      borderRadius: {
        none: "0",
        sm: "0",
        DEFAULT: "0",
        md: "0",
        lg: "0",
        xl: "0",
        "2xl": "0",
        "3xl": "0",
        full: "0",
      },

      boxShadow: {
        sm: "none",
        md: "none",
        lg: "none",
      },

      transitionDuration: {
        fast: "100ms",
        normal: "150ms",
        smooth: "200ms",
        elaborate: "300ms",
      },

      transitionTimingFunction: {
        "ease-out": "cubic-bezier(0.16, 1, 0.3, 1)",
        "ease-spring": "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },

      keyframes: {
        shimmer: {
          from: { backgroundPosition: "-200% 0" },
          to: { backgroundPosition: "200% 0" },
        },
        "pulse-dot": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.3" },
        },
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "collapsible-down": {
          from: { height: "0" },
          to: { height: "var(--radix-collapsible-content-height)" },
        },
        "collapsible-up": {
          from: { height: "var(--radix-collapsible-content-height)" },
          to: { height: "0" },
        },
      },

      animation: {
        shimmer: "shimmer 1.6s linear infinite",
        "pulse-dot": "pulse-dot 2.5s ease infinite",
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "collapsible-down": "collapsible-down 0.15s ease-out",
        "collapsible-up": "collapsible-up 0.15s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;

export default config;
