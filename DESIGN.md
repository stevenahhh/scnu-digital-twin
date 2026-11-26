# SCNU Digital Twin Design System

## 1. Atmosphere & Identity

An operational campus command center with restrained, high-contrast surfaces over a live spatial canvas. The signature is the layered relationship between the VWorld map, compact telemetry panels, and selectable 3D building details; spatial content remains primary while controls stay quiet and precise.

`frontend/src/ui/tokens.css` is the only source of design tokens. `frontend/tailwind.config.js` exposes them by name (`text-ink`, `bg-surface-1`, `rounded-card`, `text-body`, `z-hud`, `shadow-popover`, `duration-state`), and `frontend/src/ui/sceneTokens.mjs` carries the few values the three.js scene needs. Tailwind's default palette is not available. Every token below is listed once with its dark and light value. `frontend/src/ui/designDoc.test.mjs` fails when this document and `tokens.css` disagree.

## 2. Color

`:root` holds the dark theme. `[data-theme="light"]` overrides only the tokens whose values differ.

| Role | Token | Dark | Light | Usage |
|---|---|---|---|---|
| Accent | `--colors-primary` | `#5e6ad2` | `#5e6ad2` | Active controls, focus rings, selection (DOM and scene) |
| Accent hover | `--colors-primary-hover` | `#828fff` | `#828fff` | Hover on accent controls |
| On accent | `--colors-on-primary` | `#ffffff` | `#ffffff` | Text and icons on `--colors-primary` (4.69:1) |
| Canvas | `--colors-canvas` | `#0b0c0e` | `#ffffff` | App and 3D background; dark grey, not near-black |
| Surface 1 | `--colors-surface-1` | `#0f1011` | `#f7f8f8` | Panels, cards, popovers |
| Surface 2 | `--colors-surface-2` | `#141516` | `#f0f2f4` | Nested controls, active segment wash |
| Surface 3 | `--colors-surface-3` | `#18191a` | `#e5e8eb` | Strong nested surfaces |
| Hairline | `--colors-hairline` | `#23252a` | `#e0e2e5` | Borders and dividers; the default `border` colour |
| Strong hairline | `--colors-hairline-strong` | `#34343a` | `#c8ccd2` | Active boundaries, slider track |
| Text | `--colors-ink` | `#f7f8f8` | `#111213` | Primary copy |
| Muted text | `--colors-ink-muted` | `#d0d6e0` | `#4f5358` | Secondary copy |
| Subtle text | `--colors-ink-subtle` | `#8a8f98` | `#6b7079` | Labels and metadata (light raised to clear 4.5:1) |
| Success | `--colors-semantic-success` | `#4ade80` | `#15803d` | Live, healthy, occupied |
| Warning | `--colors-semantic-warning` | `#fbbf24` | `#b45309` | Stale, delayed |
| Danger | `--colors-semantic-danger` | `#f87171` | `#dc2626` | Failed, invalid |
| Success wash | `--colors-semantic-success-wash` | `color-mix(success 16 %, surface-1)` | `color-mix(success 16 %, surface-1)` | Badge and alert background for success |
| Warning wash | `--colors-semantic-warning-wash` | `color-mix(warning 16 %, surface-1)` | `color-mix(warning 16 %, surface-1)` | Badge and alert background for warning |
| Danger wash | `--colors-semantic-danger-wash` | `color-mix(danger 16 %, surface-1)` | `color-mix(danger 16 %, surface-1)` | Badge and alert background for danger |
| Dim | `--colors-dim` | `rgba(0,0,0,0.2)` | `rgba(0,0,0,0.2)` | Veil over unselected buildings (20 %) |
| Label background | `--colors-label-bg` | `rgba(15,16,17,0.85)` | `rgba(247,248,248,0.85)` | Scene label chip, surface-1 at 85 % |
| Label halo | `--colors-label-halo` | `rgba(0,0,0,0.55)` | `rgba(255,255,255,0.85)` | 1 px text halo on scene labels |
| Estimate text | `--colors-estimate-ink` | `var(--colors-ink-muted)` | `var(--colors-ink-muted)` | Provenance line under estimated values; ink-muted so 12 px captions clear 4.5:1 in the light theme |
| Emergency | `--colors-emergency` | `#ff3b30` | `#ff3b30` | Emergency-vehicle body in the traffic simulation; a status colour, never the accent |
| Risk danger | `--colors-risk-danger` | `#b5179e` | `#b5179e` | Body and ring of a traffic agent at the `danger` risk level; magenta so it never reads as an emergency vehicle |
| Vehicle lane | `--colors-vehicle-lane` | `#1e88e5` | `#1e88e5` | Vehicle lanes, gates and parking links in the network debug layer (non-interactive) |

Every text role (`ink`, `ink-muted`, `ink-subtle`, the three semantic tones) clears 4.5:1 on `--colors-surface-1` in both themes. Tone text sits on its own wash, never white on a filled tone. `frontend/src/ui/tokens.test.mjs` checks every pair.

Data ramp: use it only for magnitude (heat, radiation), never for status. The steps run from low to high: `--data-heat-0` `#2c7bb6`, `--data-heat-1` `#00a6ca`, `--data-heat-2` `#00ccbc`, `--data-heat-3` `#90eb9d`, `--data-heat-4` `#ffff8c`, `--data-heat-5` `#f9d057`, `--data-heat-6` `#d7191c`. The values are the same in both themes. Pair a ramp colour with a number or a legend.

Scene colours: the 3D scene cannot read CSS variables, so `sceneTokens.mjs` repeats the accent and the scene semantic colours. `SELECTION_HEX` is the accent `#5e6ad2`, used for the selected building, the selected D4 room and the selection outline. `HOVER_HEX` (`#c7cbef`, 35 % accent and 65 % white) is the hover tint. `DIM_ALPHA` is `0.2`, matching the dim token. `EMERGENCY_HEX` repeats `--colors-emergency`, `RISK_DANGER_HEX` repeats `--colors-risk-danger` (1.65:1 from the emergency red and about 50 degrees of hue apart, where the old `#dc2626` danger body was 1.36:1 and the same hue) and `VEHICLE_LANE_HEX` repeats `--colors-vehicle-lane`; the token test fails if either pair drifts. The accent is only for interactive and selected things: the selected building or room, the selection outline, and the roof editor's draggable array footprint. Status and category colours in the scene (emergency vehicles, debug lane types) use their own tokens. Both scene semantic colours clear 3:1 against the canvas in both themes. Against the mid-grey campus paving (about `#595c59`), no saturated red can reach 3:1, so emergency vehicles also keep their red light bar and light cabin. Idle and occupied room materials are scene-only material colours and are not UI tokens. The selection hue in the scene and in the DOM is the same accent.

## 3. Typography

- Family: `Wanted Sans Variable` (self-hosted at `frontend/public/fonts/WantedSansVariable.woff2` under the SIL OFL 1.1, `font-display: swap`, preloaded by both HTML entries; no CDN), then `Wanted Sans` and the system Korean sans-serif fallbacks. Tabular figures are on for the whole body.
- Weights: 400 body, 500 captions and labels, 600 display, title and emphasis. Use 700 only when a block inside a `--text-title` section needs a second heading level. Do not use 800 or 900.
- Tracking: only `--tracking-display` (`-0.01em`) on `--text-display`. Every other step uses zero tracking. Do not use uppercase eyebrows.
- Korean text breaks on words (`word-break: keep-all` on `body`).

| Step | Size token | Line token | Weight token | Desktop | Phone (< 640 px) | Usage |
|---|---|---|---|---|---|---|
| Display | `--text-display` | `--text-display-leading` | `--text-display-weight` | 28/32, 600 | 30/34 | Headline metric values |
| Title | `--text-title` | `--text-title-leading` | `--text-title-weight` | 20/26, 600 | 22/28 | Panel, inspector and dialog titles |
| Body | `--text-body` | `--text-body-leading` | `--text-body-weight` | 14/20, 400 | 17/24 | Controls and supporting copy |
| Caption | `--text-caption` | `--text-caption-leading` | `--text-caption-weight` | 12/16, 500 | 15/20 | Metadata, scene labels, provenance |
| Micro | `--text-micro` | `--text-micro-leading` | `--text-micro-weight` | 11/14, 600 | 13/16 | D4 room tags only (badges use Caption: the panel keeps every text at or above the secondary floor) |

The phone step is larger than the audit's 13/16 px proposal on purpose, because one-handed phone reading at arm's length needs 17 px body text. Tailwind exposes the steps as `text-display`, `text-title`, `text-body`, `text-caption` and `text-micro`. Each class sets the size, line height and weight together.

## 4. Spacing & Layout

- Base unit: 4px. Tokens: `--spacing-xxs` 4px, `--spacing-xs` 8px, `--spacing-sm` 12px, `--spacing-md` 16px, `--spacing-lg` 24px, `--spacing-xl` 32px, `--spacing-xxl` 48px. Tailwind's default spacing scale stays available and maps to the same 4px grid.
- Panel widths: `--dashboard-panel-width` is 440px (100vw below 440px until the bottom sheet replaces it). `--dashboard-rail-width` is 56px, for the collapsed rail.
- Breakpoints: phone below 640px, tablet from 640px to 1023px, desktop from 1024px.
- Z-layers: every overlay takes its stacking from one of five layer tokens, in the order `--layer-canvas` (0) < `--layer-labels` (10) < `--layer-hud` (20) < `--layer-rail` (30) < `--layer-modal` (50). Tailwind exposes them as `z-canvas`, `z-labels`, `z-hud`, `z-rail` and `z-modal`. Use no other z-index values.
- Scene labels keep an 8px margin from the viewport edge and a 12px margin from HUD and panel rectangles. A label that would cross either margin is hidden, never clipped.

Layout lines (one per screen). The visual QA harness records every element that owns vertical scroll in each captured state (`scroll-owners.json` next to the frames), so these lines can be checked against the product:

Layout: dashboard - fixed: scene canvas, HUD toolbar, time card (phone: time chip, moved to the top left while the sheet is at half; the whole HUD is hidden at full), panel rail (desktop) / drawer (tablet) / bottom sheet (phone); scroll owner: the panel body; overlay stack: canvas < labels < hud < rail < modal
Layout: inspector - fixed: inspector header (name, code badge, close) pinned above the tabs (desktop) or at the sheet's half detent (phone); scroll owner: the panel body that contains it; overlay stack: canvas < labels < hud < rail < modal
Layout: D4 pane - fixed: breadcrumb, floor picker (scene floor labels on a fine pointer, a 44px floor button list on touch and phone) and the scene beside the pane; scroll owner: the room list; overlay stack: canvas < labels < hud < rail < modal
Layout: settings sheet - fixed: sheet header with close; scroll owner: the sheet body; overlay stack: canvas < labels < hud < rail < modal
Layout: presentation mode - fixed: scene canvas, time readout, tour pager; scroll owner: none; overlay stack: canvas < labels < hud < rail < modal

## 5. Components

Components are built on shadcn/ui: the Tailwind 3 generation of the `new-york` registry (Radix primitives), generated into `frontend/src/components/ui/` and themed only through the tokens. The shadcn colour variables in `tokens.css` are derived from the palette, and the radius classes map to the radius tokens (`rounded-md` control, `rounded-lg` popover, `rounded-xl` card, `rounded-sm` the 4px alias). The primitives in `frontend/src/ui/` keep the project API and wrap those components.

| Project primitive | shadcn source |
|---|---|
| Button | `button` |
| StatusBadge | `badge` |
| Alert | `alert` |
| Breadcrumb | `breadcrumb` |
| Disclosure | `collapsible` |
| Skeleton | `skeleton` |
| Popover, 더보기 and 시점 menus | `popover`, `dropdown-menu` (rendered in place, no portal) |
| AccessibleDialog | `dialog` |
| Segmented, dashboard tabs | `tabs`, `toggle-group` |
| Login card, form fields | `card`, `input`, `label`, `select`, `separator` |

Kept as project implementations: Sheet (the vaul drawer could not keep the detent heights, release-velocity snapping, reduced-motion cross-fade and handle semantics), the range inputs of TimeSlider and SliderRow (the QA harness drives `input[type=range]`), SearchField, MetricList, EstimateValue, SectionHeader, Spinner and the scene labels. Moving to the current shadcn generation needs Tailwind 4 first.

Shared primitives live in `frontend/src/ui/` and both entries use them (Legacy `AppLegacy.jsx` and VWorld `AppVWorld.jsx`). Every interactive primitive shows a 2px `--colors-primary` focus-visible outline outside the element and has a hit area of at least 44px under `(pointer: coarse)`.

### Button
- **Structure**: `variant` primary (accent fill, `--colors-on-primary` text), secondary (`surface-1`, hairline border) or ghost (no border). `size` sm or md is 32 or 40px tall on desktop and 44px under a coarse pointer. `rounded-control`. The label is a Korean verb. An icon-only button has `aria-label` and `title`.
- **States**: default, hover (`primary-hover` or a `surface-2` wash), active wash, focus-visible, disabled (`title` gives the reason), loading (one inner spinner replaces the label; no second indicator).
- **Accessibility**: native `button`, a visible focus ring, and 44px touch targets.

### Segmented
- **Structure**: a `rounded-popover` track (4px inset) with equal-width text segments (control radius, the same active shape as every pressed control) that use Korean nouns. It is `role="tablist"` or `role="radiogroup"` by `kind`.
- **States**: one active style everywhere: a `surface-2` wash, `ink` text and a 4px dot or check before the label. No accent border and no primary fill. Inactive segments use `ink-subtle` text.
- **Accessibility**: arrow keys move with a roving tabindex, `aria-selected` or `aria-checked` marks the active segment, and segments are 44px tall under a coarse pointer.

### StatusBadge
- **Structure**: `--text-caption` text on a tone wash with tone text, `rounded-control`, and an optional lucide icon. The tones are neutral, success, warning, danger, estimate (`추정`) and sample (`샘플 데이터`, `data-qa="sample-badge"`).
- **States**: static. The text is always present.
- **Accessibility**: every tone pair clears 4.5:1, and state is never shown by colour or a dot alone.

### Alert
- **Structure**: inline row at the top of the affected section: tone icon, title, plain-Korean message (cause, time, fix), optional last good value, one action per next step (`다시 시도`), optional `자세히` disclosure with a copy button; `data-qa="alert"` + `data-source`.
- **States**: danger, warning, info. A data source shows one Alert at a time.
- **Accessibility**: `role="alert"` only for danger, `role="status"` otherwise; text is selectable.

### SectionHeader
- **Structure**: a sentence-case Korean title (`--text-title` or `--text-body` weight 600) rendered as `h3` by default, with a `level` prop and an optional badge. A subtitle may appear at most once in any three sections.
- **States**: static.
- **Accessibility**: real heading levels; no uppercase eyebrows, no tracking, no accent-coloured icons.

### Breadcrumb
- **Structure**: `nav[aria-label="breadcrumb"]` for campus > building > floor > room. Every segment except the last is a button. It carries `data-qa="breadcrumb"`.
- **States**: default, hover, focus-visible, current (last, not a button).
- **Accessibility**: `aria-current="page"` on the last segment; one Back action goes to the parent.

### Disclosure
- **Structure**: a summary button with a chevron that rotates when open. The container grows in place.
- **States**: collapsed, expanded.
- **Accessibility**: `aria-expanded` and `aria-controls`, operable by keyboard.

### Popover
- **Structure**: anchored to its trigger, `surface-1`, hairline border, `rounded-card` (menus with a 4px inset: `rounded-popover`), `--shadow-popover`, `z-modal` layer; `role="dialog"` or `role="menu"`.
- **States**: closed or open. Esc or an outside click closes it.
- **Accessibility**: focus moves inside on open and returns to the trigger on close.

### MetricList
- **Structure**: a two-column `dl` of label and value rows for current conditions. The value slot accepts an `EstimateValue`.
- **States**: filled, empty. An empty row explains why it has no value and offers a next-action button. It never shows a bare `-`.
- **Accessibility**: matching `dt` and `dd` pairs; values are selectable text.

### EstimateValue
- **Structure**: tabular value plus unit, a `StatusBadge` reading `추정` when estimated, and a provenance line `<source> · HH:mm` in `--colors-estimate-ink`; `data-qa="estimate-value"`. Measured values use `data-qa="measured-value"` and no badge.
- **States**: estimated, measured, stale, absent (`데이터 없음` + action), updated (a highlight lasting `--motion-state`).
- **Accessibility**: a visually hidden `갱신됨` live-region note on change. An estimate never reads as a measurement.

### Skeleton
- **Structure**: block and line shapes in `surface-2`, matching the card they stand in for.
- **States**: loading only.
- **Accessibility**: `aria-hidden`. It stays static under reduced motion.

### Spinner
- **Structure**: one spinner per operation, shown only after `delayMs` (1000 ms by default). Its label names the operation (`KMA 예보 가져오는 중`).
- **States**: hidden (before the delay), visible.
- **Accessibility**: `role="status"` with the operation label.

### Sheet
- **Structure**: a phone bottom sheet (below 640px) with three detents: peek (96px), half (50 % of `100dvh`) and full (`100dvh` minus the top safe area). It has a 44x44px drag handle (`data-qa="sheet-handle"`, `aria-label="패널 크기 조절"`) and `padding-bottom: env(safe-area-inset-bottom)`.
- **States**: peek, half, full, dragging. Under reduced motion it cross-fades instead of sliding.
- **Accessibility**: ArrowUp and ArrowDown move one detent, and Esc returns to peek. The scene above stays interactive. Focus is not trapped at peek or half, and the body scrolls only at full.

### Wordmark
- **Structure**: `국립순천대학교 디지털 트윈` as the page `h1`. On the map it is plain white text centred on the map area, with `--shadow-scene-text` and no background box. When the map is narrower than 760px it drops below the HUD row.

### Alert dot
- **Structure**: an 8px warning-colour dot on a panel tab (rail icon, tab label, or the closed phone sheet's toggle). It replaces status boxes on the map. The 현황 tab counts disconnected feeds and active restriction scenarios.
- **Accessibility**: the dot is decorative; the control's accessible name carries `확인할 알림 N건`.

### Scene label chip
- **Structure**: `button[data-qa="campus-label"]` with `data-element-id`, `data-tier` and `data-state`. It uses `--text-caption` (12px on desktop, 14px under a coarse pointer or below 640px), and a transform never scales it smaller. Weight is 500 (600 when selected). It has `rounded-control`, a `--colors-label-bg` background, a hairline border, a 1px `--colors-label-halo` halo and an optional code badge. It is at most 160px wide and two lines long, and it can show a leader line to its anchor when displaced.
- **States**: idle, hover (one elevation step plus the headline value), focus, selected (accent border and text, always kept), dimmed (60 %), no-data (hollow dot), stale (grey dot), estimated (dashed border, `≈` glyph, `명칭 추정` in the accessible name).
- **Accessibility**: the minimum height is 32px with a pointer and 44px under a coarse pointer, and the hit area grows without changing the glyph. Tab order follows label priority.

### Dot marker
- **Structure**: an 8px circle for annexes until the camera is near. It expands to a chip on hover or first tap.
- **States**: idle, hover/expanded, selected.
- **Accessibility**: 44px hit area under a coarse pointer, and `aria-label` set to the building name.

### Zone label
- **Structure**: 14px letter-spaced zone name with no border, `data-tier="0"`, shown at the overview band.
- **States**: static.
- **Accessibility**: non-interactive and `aria-hidden`. The zone's buildings carry the accessible names.

### D4 building section
- **Structure**: two stacked wings, 5/6 floors, bridges on floors 3 and 5, room volumes and labels (`D4SectionExperience`, `D4WingFloorSelect`, `D4RoomGridSelect`).
- **States**: idle room, occupied room, selected room (`SELECTION_HEX`).
- **Accessibility**: room labels are real buttons; pointer selection and keyboard activation open the same detail.

### Roof installation editor
- **Structure**: a dedicated D4 mode with a roof-local 3D plane, one array-level selection surface, corner handles, and a responsive inspector sheet.
- **States**: loading, valid selection, invalid preview in `--colors-semantic-danger` with a Korean reason, saving, saved, API error.
- **Interaction**: array drag and field edits commit only after geometry validation; the latest valid edit has one-step undo. Colour transitions use `--motion-settle` and no decorative motion.
- **Accessibility**: mode tabs, array list, numeric fields, orientation controls, undo/delete/reload/save are keyboard reachable; errors use an assertive alert and do not rely on red alone.

### Solar presentation page
- **Structure**: a full-height split shell with the VWorld campus map as the primary region and one independently scrolling energy evidence rail. Solar controls remain inside the spatial region and never compete with the evidence rail for scroll ownership.
- **Responsive scroll ownership**: at `xl` and above the evidence rail owns vertical scroll inside a fixed `100dvh` shell; below `xl` the map and evidence rail form one document flow so touch users scroll the page once without nested scrollbars.
- **States**: daylight, night, API loading, API error, API empty, and calculated energy results.
- **Interaction**: month, day, hour, and minute controls update the sun position; month and day also synchronize the energy simulation date.
- **Accessibility**: every range control exposes a Korean accessible name and visible value; headings preserve natural Korean phrase wrapping at desktop, tablet, and mobile widths.

## 6. Motion & Interaction

| Token | Value | Usage |
|---|---|---|
| `--motion-micro` | 120ms | Hover, press, focus feedback |
| `--motion-state` | 200ms | State changes inside a component (segment, badge, value highlight) |
| `--motion-surface` | 300ms | Panels, sheets, the assistant dock, dialogs, menus, select lists and popovers entering, leaving or resizing |
| `--motion-camera` | 800ms | Camera fly-to between presets and selections |
| `--motion-settle` | 150ms | Label layout settle pass after camera motion; material colour transitions |
| `--motion-ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Default easing |
| `--motion-ease-enter` | `cubic-bezier(0, 0, 0, 1)` | Surfaces entering |
| `--motion-ease-exit` | `cubic-bezier(0.3, 0, 1, 1)` | Surfaces leaving |

- Only opacity, transform and filter animate.
- During a drag or fly-to, the label layer fades to 40 % and freezes. One settle pass runs after the motion ends.
- Loading veil: from the login screen until the first scene frame, a WebGL canvas draws the real terrain as contours through the scene's own camera, read every frame (before the canvas exists it uses the camera stored in the address, else the campus's first camera). A front driven by downloaded bytes spreads from the point the camera looks at, then the veil opens from the same point onto the scene. Nothing in it is a stored image or a fixed timeline.
- Reduced motion: under `prefers-reduced-motion: reduce`, `index.css` shortens every transition and animation to 0.01ms. This is the only permitted `!important`. Users get the same states without movement, and sheets cross-fade.

## 7. Depth & Surface

Hairline borders and tonal steps (`surface-1` to `surface-3`) set the dashboard hierarchy. Shadows are reserved for floating surfaces. The 3D scene gets its depth from directional light, cast and received shadows, vertical floor separation and material contrast.

| Token | Value | Usage |
|---|---|---|
| `--rounded-control` | 8px | Chips, buttons, inputs, badges, menu rows, segments inside the track |
| `--rounded-popover` | `control + --spacing-xxs` (12px) | Surfaces that hold controls with a 4px (`p-1`) inset: menus, select lists, search results, the camera list, tab lists, the segmented track |
| `--rounded-card` | `control + --spacing-xs` (16px) | Surfaces with an 8px (`p-2`) or larger inset: cards, HUD cards, the assistant dock, inspector, popovers, dialogs, sheets |
| `--rounded-pill` | 9999px | Slider track, dots |
| `--shadow-popover` | `0 20px 48px rgba(0,0,0,.28)` | Popovers, menus, the HUD toolbar |
| `--shadow-dialog` | `0 24px 64px rgba(0,0,0,.40)` | Modal dialogs |

Radii are concentric: an outer surface's radius is the radius of the controls it holds plus its inset, so `--rounded-popover` and `--rounded-card` are computed from `--rounded-control` and the spacing tokens. Give a surface the inset its radius implies (`p-1` for popover, `p-2` for card) wherever a control sits in its corner.

Transitional radius aliases: `--rounded-xs` (`control - --spacing-xxs`, 4px), `--rounded-md` (equal to `--rounded-control`) and `--rounded-lg` (equal to `--rounded-popover`, which shadcn `rounded-lg` reads) exist only for `frontend/src/ui/legacy-classes.css`. They are deleted together with that file in the W2 cleanup, and new code uses `control`, `card` or `pill`.

## 8. Accessibility Constraints & Accepted Debt

- Contrast: 4.5:1 for all text and badge pairs in both themes, and 3:1 for focus rings and control boundaries against adjacent colours.
- Touch: targets are at least 44x44px under `(pointer: coarse)`. That covers chips, preset buttons, slider thumbs (24px thumb inside a 44px tall hit area, also below 640px; 24px tall on a fine pointer) and the sheet handle.
- Focus: every control has a visible focus ring, and the ring is never clipped. Tab order runs HUD, then visible scene labels by priority, then the panel.
- Keyboard paths: orbit with arrow keys, zoom and rotate/reset buttons, `/` focuses search, ArrowLeft and ArrowRight move the time slider, and Esc closes popovers and sheets.
- Selection: values, ids and error text are selectable. Only the map layer and the label layer disable text selection.
- Estimates: every estimated value carries `추정` and a source. Measurements look different.
- Accepted debt: both root dashboards remain large components until the W2 decomposition. VWorld map navigation depends on the SDK's own accessibility surface.

### PR #125 integration

The energy tab presents the selected building energy summary before analysis and campus comparison. Desktop energy panels may grow to 680px; the shared phone sheet and tablet drawer keep their existing layout. Building selection retains the current tab and inspector behavior.

Solar presentation uses the explicit `presentationMode` renderer prop to hide dashboard controls while keeping representative solar arrays. The separate `cinematic=1` capture and `dashboardDemo=1` modes remain opt-in. Terrain anchoring uses the current fixed-level provider sample and bounded fallback rather than the older most-detailed startup sample. Weather retains cache freshness and upstream error contracts.
