# Sportsline Photography Production Dashboard

A production workflow dashboard for Sportsline Photography that integrates with PhotoDay, ShipStation, and Darkroom software.

## Features

### Phase 1 (Current)
- **Order Processing** — Pull orders from PhotoDay API, download images, and generate Darkroom-compatible `.txt` files
- **Template Mapping** — Dashboard UI to map PhotoDay products to Darkroom `.crd` template files
- **QR Code Sheets** — Generate printable sheets with up to 20 QR codes for order management
- **ShipStation Integration** — Create/delete orders in ShipStation with configurable dimensions, weights, and USPS carrier
- **Configurable File Naming** — Customize how order `.txt` files and image folders are named

### Phase 2 (Planned)
- **Wallet Sheet Renderer** — Compose 8x 2.5"x3.5" wallets on an 8x10 sheet at 300 DPI
- **PhotoDay Shipped Callback** — Notify PhotoDay when orders are shipped
- **Additional Print Layouts** — More sheet configurations beyond wallets

## Tech Stack

- **Frontend:** React
- **Backend:** Node.js / Express
- **APIs:** PhotoDay Enterprise API, ShipStation API
- **Image Processing:** Sharp
- **Print Software:** Darkroom (consumes `.txt` + `.crd` files)

## Project Structure

```
sportsline-dashboard/
├── package.json                    # Root package with dev scripts
├── server/
│   ├── index.js                    # Express server entry point
│   ├── package.json
│   ├── .env.example                # Environment config template
│   ├── config/
│   │   ├── index.js                # App configuration
│   │   ├── template-mappings.json  # Product-to-template mappings
│   │   └── filename-config.json    # Filename pattern config
│   ├── routes/
│   │   ├── photoday.js             # PhotoDay API proxy routes
│   │   ├── orders.js               # Order processing routes
│   │   ├── shipstation.js          # ShipStation integration routes
│   │   ├── settings.js             # Settings & config routes
│   │   └── printSheets.js          # Print sheet generation routes
│   └── services/
│       ├── photodayService.js      # PhotoDay API client
│       ├── shipstationService.js   # ShipStation API client
│       ├── darkroomService.js      # Darkroom txt file generator
│       ├── fileService.js          # Image download & file management
│       ├── qrcodeService.js        # QR code sheet generator
│       └── printSheetService.js    # Print sheet renderer (wallets)
└── client/
    └── src/                        # React frontend (see below)
```

## Setup

### 1. Clone and install dependencies
```bash
npm run install-all
```

### 2. Configure environment
```bash
cp server/.env.example server/.env
```

Edit `server/.env` with your credentials:
- `PHOTODAY_BEARER_TOKEN` — Your PhotoDay API bearer token
- `SHIPSTATION_API_KEY` / `SHIPSTATION_API_SECRET` — ShipStation credentials
- `DOWNLOAD_BASE_PATH` — Where to save downloaded images
- `DARKROOM_TEMPLATE_BASE_PATH` — Where `.crd` templates are stored
- `TXT_OUTPUT_PATH` — Where to save generated `.txt` files

### 3. Start development
```bash
npm run dev
```

This starts both the Express server (port 3001) and React dev server (port 3000).

## API Endpoints

### PhotoDay (Proxy)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/photoday/studios` | List studios |
| GET | `/api/photoday/jobs` | List jobs |
| GET | `/api/photoday/orders` | List orders |
| GET | `/api/photoday/orders/:id/full` | Get full order with all details |
| GET | `/api/photoday/customers` | List customers |
| GET | `/api/photoday/photos` | List photos |

### Order Processing
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/orders/process/:orderId` | Download images & generate txt for one order |
| POST | `/api/orders/process-batch` | Process multiple orders (by job or IDs) |
| POST | `/api/orders/generate-txt/:orderId` | Generate txt file only (no download) |
| POST | `/api/orders/qr-sheet` | Generate QR code sheet from custom data |
| POST | `/api/orders/qr-sheet/from-orders` | Generate QR sheet from order numbers |

### ShipStation
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/shipstation/orders` | Create order in ShipStation |
| POST | `/api/shipstation/orders/batch` | Create multiple orders |
| GET | `/api/shipstation/orders` | List ShipStation orders |
| DELETE | `/api/shipstation/orders/:id` | Delete a ShipStation order |
| POST | `/api/shipstation/orders/batch-delete` | Delete multiple orders |
| POST | `/api/shipstation/orders/:id/ship` | Mark order as shipped |

### Settings
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST/PUT/DELETE | `/api/settings/template-mappings` | Manage product-to-template mappings |
| GET/PUT | `/api/settings/filename-config` | Manage filename pattern |
| GET | `/api/settings/print-layouts` | List print sheet layouts |
| GET | `/api/settings/app-config` | Get app configuration status |

### Print Sheets
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/print-sheets/generate` | Generate a print sheet |
| POST | `/api/print-sheets/preview` | Preview a print sheet |
| POST | `/api/print-sheets/generate-batch` | Batch generate print sheets |

## Darkroom TXT File Format

Generated `.txt` files follow this format:
```
OrderFirstName=John
OrderLastName=Smith
OrderEmail=john@example.com
ExtOrderNum=109518
IndexPrint=1
Qty=1
Size=0x0
Filepath=C:\SportslinePhotos\109518\photo1.jpg
Qty=2
Size=3.5x5
Template=X:\Templates\Borders\sportsline borders\magnet-auto-print.crd
Filepath=C:\SportslinePhotos\109518\photo2.jpg
```
