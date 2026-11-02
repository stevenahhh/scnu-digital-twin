# SCNU Digital Twin Design System

## 1. Atmosphere & Identity

An operational campus command center with restrained, high-contrast surfaces over a live spatial canvas. The signature is the layered relationship between the VWorld map, compact telemetry panels, and selectable 3D building details; spatial content remains primary while controls stay quiet and precise.

## 2. Color

| Role | Token | Dark | Light | Usage |
|---|---|---:|---:|---|
| Accent | `--colors-primary` | `#3b82f6` | `#3b82f6` | Active controls and selections |
| Accent hover | `--colors-primary-hover` | `#60a5fa` | `#60a5fa` | Interactive hover |
| Canvas | `--colors-canvas` | `#010102` | `#ffffff` | App and 3D background |
| Surface 1 | `--colors-surface-1` | `#0f1011` | `#f7f8f8` | Panels and popovers |
| Surface 2 | `--colors-surface-2` | `#141516` | `#f0f2f4` | Nested controls and cards |
| Surface 3 | `--colors-surface-3` | `#18191a` | `#e5e8eb` | Strong nested surfaces |
| Text | `--colors-ink` | `#f7f8f8` | `#111213` | Primary copy |
| Muted text | `--colors-ink-muted` | `#d0d6e0` | `#4f5358` | Secondary copy |
| Subtle text | `--colors-ink-subtle` | `#8a8f98` | `#737880` | Labels and metadata |
| Hairline | `--colors-hairline` | `#23252a` | `#e0e2e5` | Borders and dividers |
| Strong hairline | `--colors-hairline-strong` | `#34343a` | `#c8ccd2` | Active boundaries |
| Success | `--colors-semantic-success` | `#27a644` | `#27a644` | Occupied/healthy state |
| Danger | `--colors-semantic-danger` | `#d45555` | `#d45555` | Error state and destructive emphasis |
| Danger border | `--colors-semantic-danger-border` | `rgba(212,85,85,0.4)` | `rgba(212,85,85,0.4)` | Error surface boundary |
| Danger surface | `--colors-semantic-danger-surface` | `rgba(212,85,85,0.1)` | `rgba(212,85,85,0.1)` | Error surface fill |
| Demand series | `--colors-chart-demand` | `#828fff` | `#5e6ad2` | Predicted demand chart and legend |

3D-only materials use the corresponding visual roles: primary violet for selection, slate for idle rooms, blue for occupied rooms, and amber for the selected room. They are confined to the rendered scene and do not create UI tokens.

## 3. Typography

- Primary: `Wanted Sans Variable`, `Wanted Sans`, system Korean sans-serif fallbacks.
- Display: 28px/600/1.2 for large metric values.
- Title: 20px/700/1.4 for panel and popup headings.
- Body: 14px/400/1.5 for controls and supporting content.
- Caption: 12px/500/1.4 for metadata and room labels.
- Overline: 11-12px/800/1.3 with 0.08em tracking for spatial mode labels.

## 4. Spacing & Layout

- Base unit: 4px.
- Tokens: `--spacing-xxs` 4px, `--spacing-xs` 8px, `--spacing-sm` 12px, `--spacing-md` 16px, `--spacing-lg` 24px, `--spacing-xl` 32px, `--spacing-xxl` 48px.
- The dashboard is a bounded `100dvh` overlay-stack. VWorld/Three.js owns the spatial canvas; the right dashboard panel owns its own vertical scroll.
- The energy detail panel grows from 440px up to 680px while retaining map space; changes to the remaining VWorld area drive camera reframing.
- At 439px and below, the detail panel uses the full viewport and the panel toggle restores the spatial canvas when needed.
- Popups remain within the viewport and collapse to the available inline size on narrow screens.

## 5. Components

### Dashboard surface
- **Structure**: bordered surface using `surface-1`, optional nested `surface-2` regions.
- **States**: default, active, loading, error.
- **Accessibility**: text contrast follows WCAG AA; state is not conveyed by color alone.

### Spatial mode toolbar
- **Structure**: compact cluster of back and zoom buttons above the 3D canvas.
- **States**: default, hover, focus-visible, active.
- **Accessibility**: every icon button has a Korean accessible name and title.

### D4 building section
- **Structure**: two stacked wings, 5/6 floors, bridges on floors 3 and 5, room volumes and labels.
- **States**: idle room, occupied room, selected room.
- **Accessibility**: room labels are real buttons; pointer selection and keyboard activation open the same detail.

### Room detail popup
- **Structure**: title/actions, status grid, room metadata, energy summary, schedule view.
- **States**: detail, schedule, empty schedule, closed.
- **Accessibility**: dialog semantics, labelled heading, close/back buttons, bounded scroll body.

### Roof installation editor
- **Structure**: a dedicated D4 mode with a roof-local 3D plane, one array-level selection surface, corner handles, and a responsive inspector sheet.
- **States**: loading, valid selection, invalid red preview with Korean reason, saving, saved, API error.
- **Interaction**: array drag and field edits commit only after geometry validation; the latest valid edit has one-step undo. Color transitions use the existing 150ms token and no decorative motion.
- **Accessibility**: mode tabs, array list, numeric fields, orientation controls, undo/delete/reload/save are keyboard reachable; errors use an assertive alert and do not rely on red alone.

### Solar presentation page
- **Structure**: a full-height split shell with the VWorld campus map as the primary region and one independently scrolling energy evidence rail. Solar controls remain inside the spatial region and never compete with the evidence rail for scroll ownership.
- **Responsive scroll ownership**: at `xl` and above the evidence rail owns vertical scroll inside a fixed `100dvh` shell; below `xl` the map and evidence rail form one document flow so touch users scroll the page once without nested scrollbars.
- **States**: daylight, night, API loading, API error, API empty, and calculated energy results.
- **Interaction**: month, day, hour, and minute controls update the sun position; month and day also synchronize the energy simulation date.
- **Accessibility**: every range control exposes a Korean accessible name and visible value; headings preserve natural Korean phrase wrapping at desktop, tablet, and mobile widths.

## 6. Motion & Interaction

- Micro interactions use 150ms ease-out; panel changes use 300ms ease-in-out.
- Only opacity, transform, and filter animate.
- D4 selection is a meaningful spatial mode change; no decorative looping motion is added.
- Presentation capture uses a 60-second, constant-speed VWorld drone path: an outside approach that establishes the main gate, stadium flyover, dormitory, west-side climb, engineering loop, Engineering Building 3, library, and a forward-looking descent that ends before passing Life Sciences. The camera travels along one arc-length spline at roughly 26 m/s, faces its forward tangent, shifts from a shallow approach angle to an aerial survey angle and back for descent, and banks only slightly through turns; it never jump-cuts, zooms between targets, or loops during normal product use. The route remains isolated behind the explicit `cinematic=1` capture mode.
- Reduced-motion users receive the same states without nonessential transitions.

## 7. Depth & Surface

Mixed strategy: hairline borders and tonal shifts define dashboard hierarchy; prominent shadows are reserved for floating popups. The 3D scene earns depth from directional light, cast/receive shadows, vertical floor separation, and material contrast.

## 8. Accessibility Constraints & Accepted Debt

- Target WCAG 2.2 AA, visible focus, full keyboard reachability for controls and room buttons, and readable Korean text at supported widths.
- The legacy root dashboard remains a large component; new D4 behavior is isolated in focused modules instead of adding more responsibilities to it.
- VWorld itself is desktop-first and canvas-based; the D4 detail overlay reflows, but full map navigation remains dependent on the SDK's own accessibility surface.
