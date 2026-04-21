# Sportsline Photography Production Dashboard

A full-stack production workflow dashboard for photography labs that integrates with **PhotoDay PDX**, **ShipStation**, and **Darkroom** print software. Built for Sportsline Photography, designed to be shared with other studios.

## Features

### Order Management
- **Auto-fetch orders** from PhotoDay PDX on a configurable interval (5–60 minutes)
- **Auto-download images** when orders are fetched (while asset URLs are fresh)
- **Process orders** — downloads images, applies imposition layouts, generates packing slips, creates Darkroom txt files, and sends to ShipStation in one click
- **Process All** — batch process all unprocessed orders (respects gallery filter)
- **Reprocess** — re-download and regenerate files for orders in Awaiting Shipment or Shipped
- **Gallery filter** — filter orders by gallery across all tabs
- **Clickable order numbers** — links directly to the order in PhotoDay PDX (handles both dropship and bulk URLs)
- **Status tracking** — orders flow through Unprocessed → Awaiting Shipment → Shipped
- **Auto-refresh** — order lists update automatically when counts change

### Shipping
- **ShipStation integration** — orders are created in ShipStation as "awaiting shipment" when processed
- **Auto-ship detection** — polls ShipStation every 5 minutes for purchased labels, automatically updates order status and sends PhotoDay callback
- **Batch ship** — mark all awaiting orders as shipped (with or without tracking number), respects gallery filter
- **PhotoDay callbacks** — always sends shipped notification to PhotoDay (with or without tracking)
- **Sync to PhotoDay** — button on Shipped tab to retroactively sync orders that weren't previously synced
- **Gallery passed as Company** in ShipStation ship-to address

### Imposition Engine
- **Configurable layouts** — define grid layouts (cols × rows), item sizes, sheet sizes, all in inches
- **No stretching** — images placed at true size, extra space stays white
- **Separate col/row gaps** — independent column and row gaps in inches
- **Center on sheet** — toggle to auto-center content, or set manual left/top margins
- **Text overlays** — add text anywhere on the sheet with variables, multi-line support (`\n`), rotation, color picker, and font size
- **Text variables** — `{order_id}`, `{gallery}`, `{first_name}`, `{last_name}`, `{date}`, `{studio}`, `{item_description}`, `{item_sku}`, `{quantity}`, `{datetime}`
- **Live preview** — visual editor with dark background, inch rulers, accurate positioning, gap indicators, text overlay placement with coordinates
- **Product → Layout mappings** — map externalIds to layouts so the right imposition is applied automatically

### Packing Slips
- **5"×8" JPG** at 300 DPI, one per order
- **Content** — logo (or text fallback), order number, date, gallery, shipping option, order type (bulk/dropship), studio name, ship-to address with phone, all line items with thumbnails
- **Thumbnails** — aspect-ratio preserved (no cropping)
- **Highlights** — specialty items highlighted in configurable color (default yellow) with "SPECIALTY" badge; qty > 1 highlighted in configurable color (default green) with "CHECK QTY" badge
- **QR code** — order number encoded as QR in bottom-left corner
- **Printed with order** — added as first line item in Darkroom txt at size 5×8

### Darkroom TXT Files
- **Size from mappings** — Product Size Mappings (externalId → size) configured in Settings, falls back to parsing description
- **Specialty items excluded** — specialty products are not included in txt files
- **Packing slip first** — always the first print item at 5×8
- **Configurable filename** — pattern with tokens: `{order_number}`, `{first_name}`, `{last_name}`, `{gallery}`, `{date}`

### Folder Sort System
- **Configurable hierarchy** — Gallery, Order ID, Shipping Type, Shipping Name, Studio, Date, or No Sort (flat)
- **No Sort** — all files flat in root folder, exclusive (can't combine with other levels)
- **Shortcuts on Orders page** — quick buttons for Flat, Gallery, Shipping Type, Gallery→Shipping Name
- **Settings UI** — build hierarchy with individual level buttons, reorder with ↑/↓, save

### Specialty Products
- **ExternalId-based routing** — mark products as specialty in Settings
- **Separate folder** — images routed to `{base_path}\{product_name}\`
- **Excluded from Darkroom** — specialty items don't appear in txt files
- **Packing slip highlights** — highlighted with configurable color and "SPECIALTY" badge
- **Configurable base folder** and per-product subfolder names
- **Color pickers** — click to choose highlight colors for specialty and qty > 1

### Dashboard
- **Order counts** — clickable status cards (Unprocessed, Awaiting Shipment, Shipped, Total)
- **Production throughput** — orders processed today / this week / this month
- **Average processing time** — fetch-to-processed duration
- **Total images** — all time and this week
- **Specialty items pending** — count of unprocessed specialty items
- **Quick actions** — Fetch New Orders, Process All, Check ShipStation, View Orders, Settings
- **Order volume chart** — 14-day bar chart (fetched, processed, shipped)
- **Gallery overview** — all galleries with order counts and status badges, click to navigate
- **Product breakdown** — horizontal bar chart of total items by product type
- **Recent orders** — last 10 processed/shipped with clickable PhotoDay links

### Path Configuration
- **UI-configurable paths** — Download Base, Darkroom Template Base, TXT Output
- **Path variables** — `{date}`, `{year}`, `{month}`, `{day}`, `{month_name}`, `{day_of_week}`, `{gallery}`, `{order_id}`, `{studio}`
- **Live preview** — shows resolved paths as you type
- **Overrides .env** — saved to JSON, no server restart needed for path changes

### Application Setup
- **All credentials in UI** — PhotoDay Lab ID, Secret, ShipStation API Key/Secret, paths, defaults
- **Secret masking** — credentials shown as ••••••••, with show/hide toggle
- **No .env editing needed** — new studios can configure everything from Settings → Setup
- **Persisted to JSON** — overrides .env values, applied on startup

## Tech Stack

- **Frontend:** React
- **Backend:** Node.js / Express
- **APIs:** PhotoDay PDX Integration API, ShipStation V1 API
- **Image Processing:** Sharp
- **QR Codes:** qrcode
- **Print Software:** Darkroom (consumes `.txt` files)

## Project Structure

```
sportsline-dashboard/
├── server/
│   ├── index.js                        # Express server entry point
│   ├── .env.example                    # Environment config template
│   ├── config/
│   │   ├── index.js                    # App configuration with path variable resolution
│   │   ├── appSettings.js             # UI-configurable settings (env overrides)
│   │   ├── pathConfig.js              # Path override manager with variables
│   │   ├── orders-db.json             # Order database (auto-created)
│   │   ├── template-mappings.json     # Product → Darkroom template mappings
│   │   ├── filename-config.json       # Txt filename pattern
│   │   ├── imposition-layouts.json    # Imposition layout definitions
│   │   ├── size-mappings.json         # Product → print size mappings
│   │   ├── folder-sort.json           # Folder sort hierarchy
│   │   ├── specialty-products.json    # Specialty product routing config
│   │   ├── app-settings.json          # UI-saved credentials & settings
│   │   ├── path-overrides.json        # UI-saved path overrides
│   │   └── logo.png                   # Packing slip logo (user-supplied)
│   ├── routes/
│   │   ├── orders.js                  # Order management & dashboard analytics
│   │   ├── photoday.js                # PhotoDay PDX API proxy
│   │   ├── shipstation.js             # ShipStation integration
│   │   ├── settings.js                # All settings routes
│   │   └── printSheets.js             # Print sheet generation
│   └── services/
│       ├── photodayService.js         # PhotoDay PDX API client
│       ├── shipstationService.js      # ShipStation V1 API client
│       ├── orderDatabase.js           # Order persistence (JSON)
│       ├── schedulerService.js        # Auto-fetch, processing, ShipStation polling
│       ├── fileService.js             # Image download with folder sort & specialty routing
│       ├── darkroomService.js         # Darkroom txt generation with size mappings
│       ├── impositionService.js       # Imposition engine (grid, gaps, text, margins)
│       ├── packingSlipService.js      # 5×8 packing slip JPG generator
│       ├── folderSortService.js       # Folder hierarchy configuration
│       ├── specialtyService.js        # Specialty product routing
│       ├── qrcodeService.js           # QR code generation
│       └── printSheetService.js       # Print sheet renderer
├── client/src/
│   ├── App.js                         # Main app with navigation
│   ├── services/api.js                # API client (auto-detects server hostname)
│   ├── styles/index.css               # Global styles (dark theme)
│   └── pages/
│       ├── Dashboard.js               # Production dashboard with analytics
│       ├── OrdersPage.js              # Order management (process, ship, filter)
│       ├── SettingsPage.js            # All settings tabs
│       ├── ShipStationPage.js         # ShipStation order management
│       └── PrintSheetsPage.js         # Print sheet generation
```

## Setup

### 1. Clone and install

```bash
git clone https://github.com/jfreeman1412-stack/photoday-dashboard.git
cd photoday-dashboard
npm run install-all
```

### 2. Configure (Option A: UI Setup)

Start the server and configure everything from the browser:

```bash
cd server
node index.js
```

```bash
cd client
npm start
```

Open `http://localhost:3000` → Settings → **Setup** tab → enter your PhotoDay and ShipStation credentials.

### 2. Configure (Option B: .env file)

```bash
cp server/.env.example server/.env
```

Edit `server/.env`:

```env
PHOTODAY_API_BASE_URL=https://api.photoday.io
PHOTODAY_LAB_ID=your_lab_id_uuid
PHOTODAY_SECRET=your_jwt_secret

SHIPSTATION_API_KEY=your_api_key
SHIPSTATION_API_SECRET=your_api_secret
SHIPSTATION_API_BASE_URL=https://ssapi.shipstation.com

DOWNLOAD_BASE_PATH=C:\SportslinePhotos
DARKROOM_TEMPLATE_BASE_PATH=X:\Templates\Borders\sportsline borders
TXT_OUTPUT_PATH=C:\SportslinePhotos\Orders

DEFAULT_CARRIER=USPS
DEFAULT_DPI=300
```

### 3. Start

```bash
# Terminal 1: Start server
cd server
node index.js

# Terminal 2: Start frontend
cd client
npm start
```

Open `http://localhost:3000` in your browser.

### 4. Add your logo

Place your logo file at `server/config/logo.png` for packing slips. Any PNG will work — it's resized to fit (max 500px wide × 150px tall).

## Network Access

Other computers on the network can access the dashboard at `http://<server-ip>:3000`. The API URL is auto-detected from the browser's hostname.

Make sure Windows Firewall allows Node.js on ports **3000** and **3001**.

## Important Notes

- **Use `node index.js`** instead of `nodemon` to avoid restart loops from JSON config file writes
- **PhotoDay asset URLs change** each time an order is returned — images should be downloaded promptly after fetching
- **ShipStation polling** runs every 5 minutes (hardcoded) — detects label purchases and auto-ships
- **Auto-fetch interval** is configurable from 5–60 minutes via the Orders page dropdown

## PhotoDay PDX API

This app uses the PDX Integration API (3 endpoints only):

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/pdx/{lab_id}/integrations/orders` | Get up to 50 unprocessed orders |
| POST | `/pdx/{lab_id}/integrations/orders/{num}/processed` | Mark order as processed |
| POST | `/pdx/{lab_id}/integrations/orders/{num}/shipped` | Send shipped callback with tracking |

**Note:** The Enterprise API (`api-dev.photoday.io/ent/`) does NOT work — only the PDX Integration API works.

## Darkroom TXT File Format

```
OrderFirstName=Rachel
OrderLastName=Fenrich
OrderEmail=info@sportslinephotography.com
ExtOrderNum=NE1776736154
Qty=1
Size=5x8
Filepath=C:\SportslinePhotos\NE1776736154_packing_slip.jpg
Qty=1
Size=8x10
Filepath=C:\SportslinePhotos\Tiny Twirl- Lilac Tap-12a90748.jpg
```

The packing slip is always the first line item. Specialty items are excluded.

## Settings Tabs

| Tab | Description |
|-----|-------------|
| **Imposition Layouts** | Grid layouts with live preview, text overlays, product mappings |
| **Product Sizes** | Map externalId → print size for Darkroom txt files |
| **Specialty Products** | Route products to separate folders, exclude from Darkroom, configure highlight colors |
| **Folder Sort** | Build folder hierarchy for organizing downloaded files |
| **Darkroom Templates** | Map products to .crd template files |
| **Filename Config** | Customize txt filename pattern with tokens |
| **Paths** | Configure download/template/output paths with variables |
| **Setup** | API credentials, defaults (secrets masked after saving) |

## License

Proprietary — Sportsline Photography
