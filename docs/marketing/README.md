# UnderForge marketing one-pager

## Files

- **`underforge-one-pager.html`** — A4 portrait one-pager (print or PDF export)

## Open locally

From the repo root:

```bash
open docs/marketing/underforge-one-pager.html
```

Or serve (fixes some browsers’ `file://` image restrictions):

```bash
npx --yes serve docs/marketing -p 3456
# open http://localhost:3456/underforge-one-pager.html
```

## Export PDF

1. Open the HTML file in Chrome or Safari.
2. **Print** → Destination: **Save as PDF**
3. Paper: **A4**, margins: **None** or **Minimum**, background graphics: **On**

The floating **Export PDF (Print)** button triggers the same flow.

## Screenshots

Uses assets from `assets/images/one-pager/`:

| # | File | Caption |
|---|------|---------|
| 1 | `1-Choose-coach.png` | Pick a coach with real expertise |
| 2 | `2-log.png` | Log it. Your coach uses it. |
| 3 | `3-weekly-check-in.jpeg` | Your whole week, one place |
| 4 | `4-not-just-chat.png` | A superior experience — Not just another chat |

- `docs/marketing/app-store-qr.png` — iOS App Store (brand orange on `#0B1114`)
- `docs/marketing/whatsapp-waitlist-qr.png` — Android waitlist via WhatsApp

iOS → [App Store](https://apps.apple.com/de/app/underforge/id6758098630)  
Android → `wa.me/4915128914812` with prefilled waitlist message

**QR longevity:** The code encodes that App Store URL. It does not expire on a schedule. It keeps working as long as that listing URL stays valid (same app ID on the store). Regenerate only if you change the store link or want new colors/size.

## Brand reference

Colors and type match `rebranding_masculine_muscle_style.md` and `constants/Typography.ts` (Playfair Display + Inter, `#0B1114`, `#F47C3C`).
