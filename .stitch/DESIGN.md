---
name: Ollama Profiler
colors:
  surface: '#0b0d10'
  surface-dim: '#090b0e'
  surface-bright: '#1a1f27'
  surface-container-lowest: '#080a0d'
  surface-container-low: '#0e1115'
  surface-container: '#111419'
  surface-container-high: '#151920'
  surface-container-highest: '#1b2028'
  on-surface: '#f2f4f7'
  on-surface-variant: '#bdc4cf'
  inverse-surface: '#f2f4f7'
  inverse-on-surface: '#111419'
  outline: '#747e8e'
  outline-variant: '#252b34'
  surface-tint: '#b8f44a'
  primary: '#b8f44a'
  on-primary: '#10140c'
  primary-container: '#293718'
  on-primary-container: '#dfffa3'
  inverse-primary: '#52720f'
  secondary: '#69e8ae'
  on-secondary: '#071a12'
  secondary-container: '#153a2b'
  on-secondary-container: '#b5f8d8'
  tertiary: '#ffce6b'
  on-tertiary: '#211704'
  tertiary-container: '#49370e'
  on-tertiary-container: '#ffe5aa'
  error: '#ff7d86'
  on-error: '#280407'
  error-container: '#4c171c'
  on-error-container: '#ffc1c5'
  primary-fixed: '#dfffa3'
  primary-fixed-dim: '#b8f44a'
  on-primary-fixed: '#10140c'
  on-primary-fixed-variant: '#344914'
  secondary-fixed: '#b5f8d8'
  secondary-fixed-dim: '#69e8ae'
  on-secondary-fixed: '#071a12'
  on-secondary-fixed-variant: '#174d38'
  tertiary-fixed: '#ffe5aa'
  tertiary-fixed-dim: '#ffce6b'
  on-tertiary-fixed: '#211704'
  on-tertiary-fixed-variant: '#60450d'
  background: '#0b0d10'
  on-background: '#f2f4f7'
  surface-variant: '#151920'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 62px
    fontWeight: '520'
    lineHeight: 61px
    letterSpacing: -0.06em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 30px
    letterSpacing: -0.03em
  title-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: -0.01em
  body-base:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: '0'
  body-bold:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: '0'
  label-caps:
    fontFamily: SFMono-Regular
    fontSize: 8px
    fontWeight: '600'
    lineHeight: 12px
    letterSpacing: 0.15em
  metric-lg:
    fontFamily: SFMono-Regular
    fontSize: 30px
    fontWeight: '500'
    lineHeight: 36px
    letterSpacing: -0.04em
rounded:
  sm: 0.375rem
  DEFAULT: 0.5rem
  md: 0.625rem
  lg: 0.75rem
  xl: 1rem
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  gutter: 28px
  margin-mobile: 20px
  margin-desktop: 64px
---

## Brand & Style

Ollama Profiler is a focused engineering instrument for inspecting fleets of
Ollama servers. Its personality is precise, quiet, trustworthy, and
performance-oriented. The interface should feel like a refined native developer
tool: dense enough to compare many endpoints, but never like an overloaded
operations dashboard.

The visual language is dark graphite with one electric-lime signal color.
Decoration is restrained. Data, status, and action hierarchy create the visual
interest. Do not use photographs, decorative illustration, glossy effects, or
large areas of saturated color.

## Colors

The base canvas is **Graphite Black** (`#0b0d10`). Cards move through a narrow
surface hierarchy from `#0e1115` to `#1b2028`; thin cool-gray borders separate
regions without heavy shadows.

**Profiler Lime** (`#b8f44a`) is reserved for primary actions, current
navigation, active controls, and critical metric highlights. **Mint**
(`#69e8ae`) means online or successful. **Amber** (`#ffce6b`) means pending,
slow, or warning. **Coral** (`#ff7d86`) means offline, failed, or destructive.
Every status must include a text label or icon in addition to color.

Primary text is off-white (`#f2f4f7`), secondary text is cool gray
(`#bdc4cf`), and metadata is muted slate (`#747e8e`). Maintain strong contrast
for endpoints, model names, and benchmark figures.

## Typography

Use **Inter** or the operating system UI sans-serif for all navigation, headings,
body copy, and controls. Large page headings use moderate weight with very tight
tracking; they should look editorial and technical rather than heavy.

Endpoints, token rates, durations, tags, uppercase eyebrow labels, and task
status use the native monospace stack: `SFMono-Regular`, `Cascadia Code`,
`Consolas`, then `monospace`. Monospace is a data affordance, not a decorative
font, so it stays small and crisp.

## Layout & Spacing

The desktop shell uses a fixed 216px sidebar, a 58px sticky toolbar, and one
scrolling content region. Content may grow to 1440px and uses responsive outer
padding from 28px to 64px.

Use a strict 4px spacing rhythm. Dense rows may use 8–12px vertical spacing;
cards use 16–24px internal padding. Overview metrics form a connected four-cell
strip. Server and model tables prioritize scanability, with model filters kept
near the result list.

At narrower desktop widths, metric and detail grids collapse before content is
truncated. Endpoints and model names may wrap or ellipsize with a discoverable
full value.

## Elevation & Depth

Depth comes from surface tone, thin `#252b34` borders, and a subtle translucent
sticky toolbar blur. Avoid conventional drop shadows on data cards. The only
glow is a very restrained lime halo around the product mark or an active status.

Modal and popover layers use the highest graphite surface plus a 1px border.
The background receives a quiet radial lime tint near the top, never a visible
marketing gradient.

## Shapes

Controls use compact 8px corners. Cards and grouped metric surfaces use 10–12px
corners. Status indicators may use full pill roundness, while square product and
provider marks stay around 9px. Avoid exaggerated pill buttons and oversized
rounding.

## Components

### Sidebar Navigation

Navigation rows are 39px high with an icon and concise label. The selected row
uses a slightly brighter surface, white text, a 2px lime leading rule, and a
lime icon. The macOS title-bar drag region must never cover clickable items.

### Buttons

Primary buttons use lime fill with near-black text. Secondary buttons use a
graphite surface and cool-gray border. Destructive actions use coral text or
border and must not resemble the primary action. Minimum desktop target height
is 36px; icon-only buttons retain an accessible label.

### Metric Cards

Show one uppercase label, one prominent numeric value, and one short explanatory
line. Figures use monospace. Avoid charts when the exact value communicates the
state more clearly.

### Server Rows

The endpoint is the row identity and uses monospace. Supporting columns show
region, Ollama version, online state, installed-model count, last contact, and
latest benchmark summary. Online and authorization states must remain distinct.

### Model and Benchmark Rows

Display the exact model name including tag, capabilities, latest attempt,
latest successful token rate, TTFT, load duration, and timestamp. A recent
failure may appear alongside the retained last successful speed; never replace
the successful metric with the failure.

### Inputs and Filters

Inputs use the low graphite surface, a 1px border, and a lime focus ring.
Labels remain visible. Exact-model search uses discovered model names and tags;
status filters should be compact and keyboard accessible.

### Import Preview

Before writing data, show provider detection, total rows, valid rows, duplicate
rows, invalid rows, representative endpoints, and bounded issue details.
Benchmark authorization is a separate explicit checkbox and defaults off.

### Status and Progress

Scanning may run across servers concurrently, but activity for the same server
is presented as one serial queue. Progress copy should say what is happening
(`Scanning 5 of 20`, `Benchmarking llama3:8b`) and should never imply that a
publicly reachable endpoint is authorized for generation.

## Motion & Accessibility

Transitions are 120–180ms and limited to hover, focus, selected state, and small
progress changes. Respect reduced-motion preferences. Keyboard focus is always
visible in lime, and no state relies on color alone. Dense text should remain at
least 11px except uppercase monospace eyebrows, which may be 8px with generous
tracking.

## Safety Language

The product consistently says that inventory scanning is read-only and that
generation benchmarks require explicit authorization. Public reachability is
never described as permission. Credential storage and imported data are
described as local-only.
