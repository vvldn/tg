# REST API Contract

Base URL: `http://<host>:<port>/api`

All responses are `application/json`.

---

## POST /api/tour/nearest

Find the nearest monument with an onboarded tour.

### Request

```
Content-Type: application/json

{
  "lat": 28.5933,
  "lng": 77.2508
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `lat` | number | yes | Latitude (-90 to 90) |
| `lng` | number | yes | Longitude (-180 to 180) |

### Response 200

```json
{
  "tour_id": "humayuns-tomb",
  "name": "Humayun's Tomb",
  "center": { "lat": 28.5933, "lng": 77.2508 },
  "distance_meters": 142,
  "city": "New Delhi",
  "country": "India",
  "heritage_status": "UNESCO World Heritage Site",
  "estimated_duration_minutes": 38,
  "spot_count": 7,
  "thumbnail_url": null
}
```

| Field | Type | Description |
|-------|------|-------------|
| `tour_id` | string | Monument slug, used as path param for other endpoints |
| `name` | string | Display name |
| `center` | LatLng | Monument center coordinates |
| `distance_meters` | number | Distance from request coords to monument center |
| `city` | string \| null | City name |
| `country` | string \| null | Country name |
| `heritage_status` | string \| null | e.g. "UNESCO World Heritage Site" |
| `estimated_duration_minutes` | number | Total tour duration including walking |
| `spot_count` | number | Number of stops in the tour |
| `thumbnail_url` | string \| null | Image URL (null for MVP) |

### Response 404

No tours found within search radius (default 50km).

```json
{
  "error": "no_tours_nearby",
  "message": "No tours found within 50km"
}
```

### Response 400

Invalid coordinates.

```json
{
  "error": "invalid_coordinates",
  "message": "lat must be between -90 and 90, lng must be between -180 and 180"
}
```

---

## GET /api/tour/:tourId

Get full tour metadata for the Tour Ready screen. Does NOT include narration content — that comes via WebSocket.

### Request

```
GET /api/tour/humayuns-tomb
```

### Response 200

```json
{
  "tour_id": "humayuns-tomb",
  "name": "Humayun's Tomb",
  "center": { "lat": 28.5933, "lng": 77.2508 },
  "city": "New Delhi",
  "country": "India",
  "heritage_status": "UNESCO World Heritage Site",
  "inception": "1572",
  "architect": "Mirak Mirza Ghiyas",
  "architectural_style": "Mughal architecture",
  "estimated_duration_minutes": 38,
  "spot_count": 7,
  "spots_preview": [
    { "id": "main-gateway", "name": "Main Gateway (West Gate)", "order": 1 },
    { "id": "bu-halimas-garden", "name": "Bu Halima's Garden", "order": 2 },
    { "id": "isa-khans-tomb", "name": "Isa Khan's Tomb", "order": 3 },
    { "id": "afsarwala-tomb", "name": "Afsarwala Tomb and Mosque", "order": 4 },
    { "id": "arab-ki-sarai", "name": "Arab Ki Sarai", "order": 5 },
    { "id": "char-bagh", "name": "Char Bagh (Four Gardens)", "order": 6 },
    { "id": "main-tomb", "name": "Main Tomb of Humayun", "order": 7 }
  ],
  "overview_text": "Humayun's Tomb is one of the finest examples of Mughal architecture...",
  "thumbnail_url": null
}
```

| Field | Type | Description |
|-------|------|-------------|
| `tour_id` | string | Monument slug |
| `name` | string | Display name |
| `center` | LatLng | Monument center coordinates |
| `city` | string \| null | City |
| `country` | string \| null | Country |
| `heritage_status` | string \| null | Heritage designation |
| `inception` | string \| null | Year of construction |
| `architect` | string \| null | Architect name |
| `architectural_style` | string \| null | Style |
| `estimated_duration_minutes` | number | Total tour duration |
| `spot_count` | number | Number of stops |
| `spots_preview` | array | Ordered list of stops (id, name, order only) |
| `overview_text` | string | First ~200 chars of the overview narration |
| `thumbnail_url` | string \| null | Image URL (null for MVP) |

### Response 404

```json
{
  "error": "tour_not_found",
  "message": "No tour with id 'xyz'"
}
```

---

## GET /api/health

Health check endpoint.

### Response 200

```json
{
  "status": "ok",
  "bundles_loaded": 3,
  "active_sessions": 12
}
```
