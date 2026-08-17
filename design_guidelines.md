# Resumax - Mobile Design Guidelines

## Architecture Decisions

### Authentication
**Decision: No Authentication Required**
- The app is a utility/single-user focused tool for resume improvement
- Data is processed and stored locally on device
- **Profile/Settings Screen Required**:
  - User-customizable avatar (1 preset professional avatar - minimalist silhouette in app accent color)
  - Display name field for personalization
  - App preferences: theme toggle (light/dark), notification settings for processing completion

### Navigation Architecture
**Root Navigation: Tab Navigation (3 tabs)**

The app has 3 distinct feature areas:
1. **Home Tab** (Upload & Process) - Core action center
2. **History Tab** - Past processed resumes
3. **Profile Tab** - Settings and preferences

Tab bar positioning:
- Upload positioned in center tab as the core action
- Order: History | Upload | Profile

**Information Architecture:**
```
├── Home Stack
│   ├── Upload Screen (initial)
│   └── Processing Screen (modal overlay)
│   └── Preview Screen (pushed)
├── History Stack
│   ├── History List Screen
│   └── Resume Detail Screen (pushed)
└── Profile Stack
    └── Profile/Settings Screen
```

## Screen Specifications

### 1. Upload Screen (Home Tab - Initial Screen)
**Purpose:** Primary interface for uploading and initiating resume improvement

**Layout:**
- **Header:** Transparent, custom navigation header
  - Left: None
  - Right: Info icon (shows tips modal)
  - Title: "Resumax"
  - Top inset: headerHeight + Spacing.xl

- **Main Content:** Scrollable view
  - Large upload zone (dashed border card, centered icon and text)
  - "Choose PDF" primary action button
  - Recent upload preview (if exists) below upload zone
  - Safe area bottom inset: tabBarHeight + Spacing.xl

- **Components:**
  - Upload zone card (min height 200px, dashed border, tap to select)
  - Primary button with document picker
  - File name display chip (when selected)
  - Floating "Process Resume" button (appears after file selected)

**Floating Button Shadow (if used):**
- shadowOffset: {width: 0, height: 2}
- shadowOpacity: 0.10
- shadowRadius: 2

### 2. Processing Screen (Modal Overlay)
**Purpose:** Visual feedback during AI processing and PDF generation

**Layout:**
- **Full-screen modal** with semi-transparent backdrop
- Centered content card with:
  - Animated processing indicator (Lottie or system ActivityIndicator)
  - Processing stage text ("Extracting text..." → "Improving content..." → "Generating PDF...")
  - Progress percentage (if backend provides)
  - Cancel button (bottom, text button)

- **No safe area adjustments** (modal centers itself)

### 3. Preview Screen (Pushed from Home)
**Purpose:** Review improved resume text and download final PDF

**Layout:**
- **Header:** Default navigation header with back button
  - Title: "Improved Resume"
  - Right: Share icon button
  - Non-transparent header
  - Top inset: Spacing.xl

- **Main Content:** Scrollable view showing improved text
  - Text diff view (optional: highlight changes)
  - Side-by-side comparison toggle
  - Bottom inset: tabBarHeight + Spacing.xl

- **Floating Action:**
  - Fixed bottom button: "Download PDF" (primary color)
  - Positioned above tab bar with proper safe area
  - Shadow applied per floating button specs

**Components:**
- Text display card with improved resume content
- Comparison toggle switch
- Download button (fixed, not scrollable)
- Success toast on download

### 4. History Screen (History Tab)
**Purpose:** View and access previously processed resumes

**Layout:**
- **Header:** Transparent, default navigation
  - Title: "History"
  - Right: Clear all button (text)
  - Top inset: headerHeight + Spacing.xl

- **Main Content:** FlatList/ScrollView
  - Empty state with illustration and "No resumes yet" message
  - List of resume cards (newest first)
  - Bottom inset: tabBarHeight + Spacing.xl

**Components:**
- Resume history card (shows: original filename, date processed, preview snippet)
- Swipe actions: Delete, Share
- Empty state illustration

### 5. Profile/Settings Screen (Profile Tab)
**Purpose:** User personalization and app preferences

**Layout:**
- **Header:** Transparent, default navigation
  - Title: "Profile"
  - Top inset: headerHeight + Spacing.xl

- **Main Content:** Scrollable form-style layout
  - Avatar selection (circular, 80px diameter)
  - Display name input field
  - Theme toggle (Light/Dark/System)
  - Notification preferences toggle
  - About section (app version, privacy policy placeholder, terms placeholder)
  - Bottom inset: tabBarHeight + Spacing.xl

**Components:**
- Avatar picker (circular image with edit overlay icon)
- Text input field (display name)
- Toggle switches for preferences
- Section headers and dividers
- List items for links (chevron right indicators)

## Design System

### Color Palette

> Source of truth is `constants/theme.ts`. This section mirrors it — if the two
> disagree, the code wins and this file is the thing to fix.

**Principle: neutral-first.** A zinc ramp carries the whole interface. Colour is
used to *mean* something (success, error, warning) and never for decoration.
There is deliberately no second brand colour competing for attention — which is
why the brand mark below is monochrome.

**Primary** — a deep near-black used for solid fills and emphasis. White text
sits on it legibly in both schemes.

| Token | Light | Dark |
|---|---|---|
| `primary` | `#18181B` | `#4A4A55` |
| `primaryLight` | `#3F3F46` | `#71717A` |
| `primaryDark` | `#09090B` | `#27272A` |

**Neutrals**

| Token | Light | Dark |
|---|---|---|
| `text` | `#09090B` | `#FAFAFA` |
| `textSecondary` | `#52525B` | `#A1A1AA` |
| `textMuted` | `#71717A` (4.8:1 on white) | `#7E7E88` (4.6:1 on card) |
| `backgroundRoot` | `#FAFAFA` | `#09090B` |
| `backgroundDefault` | `#FFFFFF` | `#141417` |
| `backgroundSecondary` | `#F4F4F5` | `#1C1C20` |
| `border` | `#E4E4E7` | — |

**Semantic** — muted and print-like, never neon.

| Token | Light |
|---|---|
| `success` / `successLight` | `#15803D` / `#DCFCE7` |
| `error` / `errorLight` | `#B91C1C` / `#FEE2E2` |
| `warning` / `warningLight` | `#B45309` / `#FEF3C7` |

Structure comes from hairline borders and background layers, not from drop
shadows and glows — `cardGlow` resolves to `transparent`.

### Brand & Logo

**The mark** is a rising *M* whose final upstroke continues past the cap height
and becomes an arrow. One continuous pen: the letterform and the arrow are the
same stroke weight with the same round caps and joins, so it reads as a single
gesture rather than a letter with an arrow stuck on it. The middle vertex of the
M sits *above* the baseline, which lifts the centre and makes the whole form
point upward.

The mark is generated from geometry, not traced. Proportions live in one place
and every asset is a fresh render at its target size, never a resample.

**Colour: monochrome, always.**

| Context | Background | Glyph |
|---|---|---|
| App icon | `#18181B` | `#FAFAFA` |
| On light surfaces | — | `#18181B` |
| On dark surfaces | — | `#FAFAFA` |
| Android monochrome | transparent | `#FFFFFF` (system recolours it) |

Never apply a gradient, glow, outer shadow or second hue to the mark. The
previous blue-and-orange logo is retired precisely because it contradicted the
neutral-first rule above.

**Clear space.** Keep free space of at least the stroke width (≈8% of the mark's
height) on all sides. The app icon carries a 20% inset; the Android adaptive
foreground carries 30%, because the launcher masks that layer to a shape of its
choosing and keeps only the central ~66%.

**Assets** (`assets/images/`)

| File | Size | Notes |
|---|---|---|
| `icon.png` | 1024² | Full-bleed square. iOS applies its own corner mask — a pre-rounded PNG gets masked twice and reads as inset. |
| `splash-icon.png` | 1024² | Transparent, ink glyph, for the light splash. |
| `splash-icon-dark.png` | 1024² | Transparent, paper glyph. One image cannot serve both splashes — an ink glyph is invisible on the dark background. |
| `favicon.png` | 256² | Keeps the filled background; a bare glyph disappears in a browser tab. |
| `android-icon-foreground.png` | 1024² | Transparent, 30% inset. |
| `android-icon-monochrome.png` | 1024² | Solid white silhouette; Android 13+ themed icons recolour it. |
| `logo.png` / `logo-dark.png` | 1600px wide | Mark + "Resumax" lockup for stores and marketing. |

Verified legible down to 28×28px, which is below any size the OS actually
renders the icon at.

**Minimum sizes.** Mark alone: 24px. Full lockup: 120px wide — below that, set
the mark on its own rather than shrinking the type.

### Typography
**Font Family:** System default (San Francisco on iOS, Roboto on Android)

**Type Scale:**
- Hero: 32px, Bold (Upload screen headline)
- H1: 28px, Bold (Screen titles)
- H2: 20px, Semibold (Section headers)
- Body: 16px, Regular (Main content)
- Body Small: 14px, Regular (Secondary info)
- Caption: 12px, Regular (Metadata, timestamps)
- Button: 16px, Semibold (All buttons)

### Spacing System
- xs: 4px
- sm: 8px
- md: 12px
- lg: 16px
- xl: 24px
- 2xl: 32px
- 3xl: 48px

### Component Specifications

**Buttons:**
- Primary: Filled background (Primary color), white text, height 48px, border radius 12px
- Secondary: Outlined (1px Primary color), Primary text, height 48px, border radius 12px
- Text: No background, Primary color text
- All buttons: Visual press feedback (opacity 0.7 on press)

**Cards:**
- Background: Surface color
- Border radius: 16px
- Padding: Spacing.lg
- No shadow for standard cards
- Border: 1px solid Border color

**Upload Zone:**
- Dashed border: 2px dashed Border color
- Border radius: 16px
- Padding: Spacing.2xl
- Tap feedback: Border color changes to Primary

**Input Fields:**
- Height: 48px
- Border radius: 12px
- Border: 1px solid Border color
- Focus state: Border color Primary, 2px width
- Padding horizontal: Spacing.lg

**Icons:**
- Use Feather icons from @expo/vector-icons
- Standard size: 24px
- Tab bar icons: 24px
- Button icons: 20px
- Color: Match text color hierarchy

### Critical Assets

**Required Generated Assets:**
1. **Profile Avatar** (1 preset):
   - Minimalist professional silhouette in Primary color
   - Circular, 400x400px
   - Clean, modern aesthetic suitable for professional app
   - Export as PNG with transparency

2. **Empty State Illustration** (History screen):
   - Simple illustration of document/folder
   - Matches app color palette
   - 200x200px
   - Line art style

**System Icons (Feather Icons):**
- Upload: upload-cloud
- File: file-text
- Settings: settings
- Profile: user
- History: clock
- Download: download
- Share: share-2
- Info: info
- Check: check-circle
- Close: x

### Accessibility Requirements
- Minimum touch target: 44x44px (all interactive elements)
- Color contrast: WCAG AA compliant (4.5:1 for text)
- VoiceOver/TalkBack labels for all interactive elements
- Loading states announced to screen readers
- Error messages clearly communicated
- Support for system font scaling
- Keyboard navigation support where applicable