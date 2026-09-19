import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      backgroundImage: {
        "gradient-primary": "var(--gradient-primary)",
        "gradient-accent": "var(--gradient-accent)",
        "gradient-hero": "var(--gradient-hero)",
      },
      boxShadow: {
        soft: "0 2px 10px rgba(0, 0, 0, 0.03)",
        medium: "0 4px 20px rgba(0, 0, 0, 0.05)",
        strong: "0 8px 30px rgba(0, 0, 0, 0.08)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "var(--radius)",
        sm: "var(--radius)",
        xl: "var(--radius)",
        "2xl": "var(--radius)",
        DEFAULT: "var(--radius)",
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
        // Ultra-smooth animations with easing
        "slide-in": {
          "0%": { transform: "translateY(20px) translateZ(0)", opacity: "0" },
          "100%": { transform: "translateY(0) translateZ(0)", opacity: "1" },
        },
        "slide-out": {
          "0%": { transform: "translateY(0) translateZ(0)", opacity: "1" },
          "100%": { transform: "translateY(-20px) translateZ(0)", opacity: "0" },
        },
        "slide-in-left": {
          "0%": { transform: "translateX(-20px) translateZ(0)", opacity: "0" },
          "100%": { transform: "translateX(0) translateZ(0)", opacity: "1" },
        },
        "slide-in-right": {
          "0%": { transform: "translateX(20px) translateZ(0)", opacity: "0" },
          "100%": { transform: "translateX(0) translateZ(0)", opacity: "1" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "fade-out": {
          "0%": { opacity: "1" },
          "100%": { opacity: "0" },
        },
        "scale-in": {
          "0%": { transform: "scale(0.9) translateZ(0)", opacity: "0" },
          "100%": { transform: "scale(1) translateZ(0)", opacity: "1" },
        },
        "scale-out": {
          "0%": { transform: "scale(1) translateZ(0)", opacity: "1" },
          "100%": { transform: "scale(0.9) translateZ(0)", opacity: "0" },
        },
        "rotate-in": {
          "0%": { transform: "rotate(-5deg) translateZ(0)", opacity: "0" },
          "100%": { transform: "rotate(0deg) translateZ(0)", opacity: "1" },
        },
        "shimmer": {
          "0%": { opacity: "0.3" },
          "50%": { opacity: "0.6" },
          "100%": { opacity: "0.3" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.7" },
        },
        "bounce-subtle": {
          "0%, 100%": { transform: "translateY(0) translateZ(0)" },
          "50%": { transform: "translateY(-5px) translateZ(0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
        "accordion-up": "accordion-up 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
        "slide-in": "slide-in 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
        "slide-out": "slide-out 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        "slide-in-left": "slide-in-left 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
        "slide-in-right": "slide-in-right 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
        "fade-in": "fade-in 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        "fade-out": "fade-out 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
        "scale-in": "scale-in 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        "scale-out": "scale-out 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
        "rotate-in": "rotate-in 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        "shimmer": "shimmer 1.5s ease-in-out infinite",
        "pulse-soft": "pulse-soft 2s ease-in-out infinite",
        "bounce-subtle": "bounce-subtle 0.6s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
