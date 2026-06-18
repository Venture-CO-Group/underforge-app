## 1. Overall Design Philosophy

**Positioning:** Premium, research-driven, calm confidence. The interface should feel expensive, deliberate, and restrained. No visual noise. Every element must justify its existence.

**Emotional tone:** Intelligent, composed, quietly authoritative. Never loud, never playful. The UI should feel like it knows something the user doesn’t, and isn’t in a rush to explain it.

**Visual hierarchy principle:** Fewer elements, larger type, stronger contrast. Whitespace is a functional tool, not decoration.

---

## 2. Layout System

### 2.1 Grid & Spacing

* **Primary grid:** 4pt or 8pt spacing system, applied universally
* **Horizontal padding (mobile):** 20–24pt safe margins
* **Vertical rhythm:** Large vertical gaps between major sections (48–72pt)
* **Section stacking:** Single-column, vertically stacked sections only

Avoid dense layouts. If something feels like it could fit more content, it should fit less.

### 2.2 Section Structure

Each screen should follow this predictable pattern:

1. **Anchor headline** (emotional or declarative)
2. **Supporting subtext** (clarifying, lower contrast)
3. **Primary action** (single CTA)
4. **Optional secondary information** (lists, comparisons, metrics)

Never present more than one primary action per screen.

---

## 3. Typography System

### 3.1 Typeface Roles

* **Display Serif (Primary Headlines):**

  * Used for hero statements, section anchors
  * High contrast, elegant, editorial
  * Large size, generous line height

* **Modern Sans-Serif (Body & UI):**

  * Used for body copy, navigation, labels, buttons
  * Neutral, highly legible, understated

Mixing serif emotion with sans-serif precision is mandatory.

### 3.2 Type Scale (Mobile)

* Hero headline: 34–40pt
* Section headline: 26–30pt
* Subheadline: 18–20pt
* Body text: 15–16pt
* Meta / helper text: 12–13pt

### 3.3 Typography Rules

* Headlines may break into two short lines
* Avoid long paragraphs. 2–3 lines max
* No all-caps for long text
* Sentence case preferred everywhere

---

## 4. Color System

### 4.1 Base Palette

* **Primary background (near-black):**

  * Charcoal Blue-Black: `#0B1114`
  * Deep Teal-Black (secondary background): `#0E1A1A`

* **Primary text (off-white):**

  * Soft Ivory: `#F2F2EE`

* **Secondary text:**

  * Muted Cool Gray: `#9AA3A6`
  * Low-emphasis Gray: `#6F7A7E`

### 4.2 Accent Color

* **Primary accent (warm):**

  * Burnt Orange: `#F47C3C`

* **Accent variants:**

  * Darkened Accent (pressed states): `#D8662F`
  * Soft Accent Tint (subtle highlights): `#F9A06A`

Accent usage is intentionally limited. It should visually interrupt the interface, not decorate it.

### 4.3 Functional Colors

* **Success / positive state:**

  * Muted Green: `#4FAE8A`

* **Warning:**

  * Amber: `#E0A458`

* **Error:**

  * Desaturated Red: `#C65B5B`

Functional colors should appear rarely and only in context. Never compete with the primary accent.

### 4.4 Contrast Rules

* Headlines: high contrast (Primary text on near-black background)
* Body text: medium contrast (Secondary text on near-black background)
* Meta text: low contrast but readable

Never use pure black on pure white.

---

## 5. Imagery & Visual Media

### 5.1 Image Style

* Cinematic, low-key lighting
* Deep shadows, strong contrast
* Subjects partially obscured or side-lit
* Minimal backgrounds, no clutter

### 5.2 Image Placement

* Images should feel embedded, not decorative
* Often offset, cropped, or partially hidden
* Never full-width edge-to-edge without breathing room

### 5.3 Overlays

* Dark gradient overlays required for text legibility
* Gradients should fade subtly, never harsh edges

---

## 6. Buttons & CTAs

### 6.1 Primary Button

* Rounded pill shape
* Solid accent color
* Medium-large height (48–56pt)
* Clear, concise label

### 6.2 Secondary Actions

* Text-only or subtle outline
* Lower contrast
* Never visually compete with primary CTA

### 6.3 Button Behavior

* One dominant CTA per screen
* CTA placement: lower third of screen or directly under key text

---

## 7. Navigation

### 7.1 Top Navigation

* Minimal items
* Small, understated text
* Clear separation from content via spacing, not borders

### 7.2 Bottom Navigation (if used)

* Simple icons + labels
* Muted inactive state
* Accent color only for active tab

Avoid complex navigation trees.

---

## 8. Lists, Comparisons & Rows

### 8.1 List Style

* Two-column comparison format when applicable
* Left side: muted problem or context
* Right side: brighter, more confident solution

### 8.2 Dividers

* Hairline dividers only
* Very low contrast
* Used to create rhythm, not separation

---

## 9. Motion & Interaction

### 9.1 Animation Principles

* Slow, smooth, intentional
* Ease-in-out curves
* No playful bounces or overshoot

### 9.2 Transitions

* Fade + slight vertical movement
* Content appears as if revealed, not popped in

Motion should feel expensive and restrained.

---

## 10. Content Density Rules

* One core idea per screen
* If scrolling is required, sections must feel clearly segmented
* Never overwhelm with data upfront

Progressive disclosure is preferred.

---

## 11. Accessibility & Readability

* Maintain sufficient contrast ratios
* Touch targets minimum 44pt
* Text must remain readable over imagery at all times

---

## 12. What to Avoid (Critical)

* Bright backgrounds
* Loud gradients
* Gamification visuals
* Excessive icons
* Over-explaining
* Stock fitness clichés

If it feels energetic, it’s probably wrong.

---

**Summary Rule:**
The interface should feel like a private consultation, not a fitness app. Calm, precise, and quietly confident.
