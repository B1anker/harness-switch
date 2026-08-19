# Design System: harness-switch Console

## 1. Visual Theme & Atmosphere
A graphite ops workbench for people who switch CLI providers on SSH hosts. Density is Daily App Balanced leaning cockpit (6). Variance is Offset Asymmetric (5): a persistent left rail plus a quiet workspace, never a marketing hero stacked on settings cards. Motion is Static Restrained (3): 150ms color and transform only, no perpetual loops, no scroll hijacks.

The atmosphere is a night-shift terminal room with warm copper instruments, not a SaaS landing page. Surfaces are flat, corners are tight (4px), and chrome is hairline. Light mode is cool stone paper. Dark mode is lamp-black graphite. The two modes share the same copper accent and the same layout.

This is a software console. There is no landing-page Hero with inline photographs. The first impression is Login Split (brand column + form) and then the Workspace (rail + profiles).

## 2. Color Palette & Roles
One palette, one accent. Neutrals stay in the same warm-graphite family in both modes. No purple, no neon, no pure black.

### Light
- **Stone Paper** (#F3F1EC) - Page canvas
- **Clear Surface** (#FBFAF7) - Workspace pane, dialogs, inputs
- **Lamp Ink** (#1F1D1A) - Primary text
- **Dust Steel** (#6F6A62) - Secondary text, metadata, helper copy
- **Hairline Ash** (#E4E0D8) - Borders, rails, row dividers
- **Forge Copper** (#B45309) - Single accent: primary buttons, selected rail, focus rings, active badges

### Dark
- **Lamp Black** (#1A1815) - Page canvas (not #000000)
- **Graphite Tray** (#24211D) - Workspace pane, dialogs
- **Bone Text** (#F0EBE3) - Primary text
- **Warm Steel** (#A39B90) - Secondary text
- **Hairline Ember** (rgba(240, 235, 227, 0.10)) - Borders
- **Forge Copper Light** (#E0A36A) - Same accent role as light mode, lifted for contrast on graphite

### Semantic
- **Alert Clay** (#B42318 light / #F97066 dark) - Destructive actions and inline errors only
- **Banned:** #7C3AED, #8B5CF6, neon blue glows, beige-brass luxury palettes, mixing cool slate with warm stone

## 3. Typography Rules
- **Display / UI:** IBM Plex Sans Variable - 14px body, 16-20px pane titles, tracking slightly tight on titles. Hierarchy by weight (500 / 600), not giant type.
- **Body:** IBM Plex Sans Variable - line-height 1.55, helper copy max 65ch, Dust Steel / Warm Steel.
- **Mono:** IBM Plex Mono (400 / 500) - harness ids, URLs, models, counts, env paths, timestamps. Density 6: all numbers in mono.
- **Banned:** Inter, Geist (previous iteration), generic serifs, display serifs, uppercase tracking eyebrows, gradient text.

## 4. Component Stylings
- **Buttons:** 4px radius, no drop shadow, no outer glow. Primary is Forge Copper fill with bone/ink text that meets WCAG AA. Outline is hairline on Clear Surface. Active state translates 1px down. Labels stay one line.
- **Workspace panes:** Not floating cards. A 1px Hairline Ash border on Clear Surface / Graphite Tray. Padding 20px. No heavy shadow.
- **Rails:** Left column 240px, Stone Paper / Lamp Black background, selected row uses a 2px copper leading edge plus tinted fill.
- **Inputs:** Label above, error below, 8px gap. Focus ring 1px Forge Copper. No floating labels.
- **Badges:** Compact mono, 4px radius. Active state uses copper fill. Neutral counts use Dust Steel fill.
- **Toasts:** Bottom-right, max 28rem, replace blocking "操作完成" dialogs. Auto-dismiss 8s. Close control required.
- **Loaders:** Text or skeleton bars matching row height. No circular spinners.
- **Empty states:** One sentence plus the existing 新增 action. No illustrations.

## 5. Layout Principles
- App shell: sticky 52px header, then CSS Grid `240px 1fr` below 768px collapsing to a horizontal harness strip + stacked workspace.
- Max content width 1280px is not required; the rail + workspace should fill the viewport like a tool, with 24px outer padding.
- Login is a split: left brand column (title + one-line purpose), right password form. Not a centered generic card.
- No three equal feature cards. Env-file help lives in a disclosure at the foot of the workspace, not a second hero card.
- Full height uses min-height 100dvh.
- Touch targets on mobile: harness chips and icon buttons at least 40px; desktop icon buttons may stay 36px.

## 6. Motion & Interaction
- Duration 150ms, easing cubic-bezier(0.16, 1, 0.3, 1). Animate color, opacity, transform only.
- No perpetual pulse, marquee, or typewriter. This is an ops console; motion is feedback, not decoration.
- Harness switching uses a vertical tablist (ArrowUp / ArrowDown / Home / End, plus Left / Right as aliases). The workspace is the tabpanel.
- Profile rows are the unit of work: hover tint, explicit 激活, edit and delete stay as icon actions. Do not activate on row click.
- Successful writes use a toast, not a modal. Destructive deletes still confirm.
- Theme: light / dark, persisted in localStorage key `hs-theme`. Default follows `prefers-color-scheme`. Apply class on `html` before paint to avoid a flash.

## 7. Anti-Patterns (Banned)
- No emojis
- No Inter, no Geist, no generic serif
- No #000000, no neon / outer glow, no purple / lila
- No centered marketing hero, no "Scroll to explore", no version stamps in the chrome
- No three equal cards, no uppercase tracking eyebrows
- No blocking success dialogs for routine activates
- No overlapping layers except dialogs, toasts, and the sticky header
- No AI copy ("Elevate", "Seamless", "Unleash")
- No custom cursors
