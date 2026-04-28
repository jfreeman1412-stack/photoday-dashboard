# Sportsline Photography Production Dashboard

A full-stack production workflow dashboard for photography labs that integrates with **PhotoDay PDX**, **ShipStation**, and **Darkroom** print software. Built for Sportsline Photography, designed to be shared with other studios.

## Features

### Order Management
- Auto-fetch orders from PhotoDay PDX on a configurable interval (5-60 minutes)
- Process orders: downloads images, applies imposition, generates packing slips, creates Darkroom txt files, sends to ShipStation
- Reprocess orders and Reprint single items with fresh URLs from PhotoDay
- Gallery filter with per-gallery settings (auto-process, team processing, skip ShipStation, custom folder sort)
- Smart URL handling: aborts processing if any image download fails, order stays unprocessed for URL refresh on next fetch
- Status tracking: Unprocessed → Partially Processed → Awaiting Shipment → Shipped

### Per-Team Processing
- Team filter bar for team-enabled galleries
- Process by team: only downloads/processes items matching the selected team tag
- Per-team packing slips (active team at 100% opacity, others faded to 30%)
- Per-team txt files with team name suffix
- Partially Processed status until all teams are done

### Shipping & Packaging
- ShipStation integration with automatic packaging rules engine
- 8 packaging types: flat mailers, pano tubes, boxes, pano frames
- Auto-determines dimensions, weight, carrier, and service based on order contents
- Product weight table, force-package SKU list, magnet threshold, package bundles
- Auto-ship detection via ShipStation /shipments endpoint with tracking numbers
- Skip ShipStation option for hand-delivery galleries
- Batch ship with optional tracking, PhotoDay sync

### Imposition Engine
- Configurable grid layouts with auto-size text overlays
- Text variables including {photo_tag}, {team}, {photo_tags}
- Center align and auto-size within bounding boxes
- Rotated text with automatic W/H swap for correct sizing
- Live preview editor

### Packing Slips
- Dynamic item sizing based on item count
- Larger contact info (studio name 28pt, email/phone 24pt)
- Team opacity support, specialty/qty highlights
- Buffer reads to prevent Windows file locks

### Authentication
- Login with session management, roles (Admin, Operator, Viewer)
- User management UI (admin only)

## Setup

```bash
git clone https://github.com/jfreeman1412-stack/photoday-dashboard.git
cd photoday-dashboard
npm run install-all

# Terminal 1
cd server && node index.js

# Terminal 2
cd client && npm start
```

Open http://localhost:3000 → Settings → Setup → enter PhotoDay and ShipStation credentials.
Place logo at `server/config/logo.png` for packing slips.

## Tech Stack
React, Node.js/Express, SQLite, Sharp, PhotoDay PDX API, ShipStation V1 API

## License
Proprietary — Sportsline Photography
