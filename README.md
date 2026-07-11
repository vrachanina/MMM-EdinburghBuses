# MMM-EdinburghBuses

A [MagicMirror²](https://github.com/MagicMirrorOrg/MagicMirror) module that displays live bus
departure times for chosen Edinburgh bus stops, optionally filtered to specific route numbers.

This is a rewrite of the now-unsupported [`MMM-LothianBuses`](https://github.com/tbouron/MMM-LothianBuses)
module. That module called the old `tfe-opendata.com` / mybustracker API, which has been replaced by
the **Edinburgh Travel Tracker Open API** (NOVUS-RT, run by Trapeze for City of Edinburgh Council).
This module talks to that new API instead. Layout and config style are intentionally close to the
original so it should feel familiar if you used it before.

## How it's different from the old module

- Uses the new `StopEvents` endpoint on `edinburghtraveltracker.com` instead of the retired
  `tfe-opendata.com/api/v1/live_bus_times` endpoint.
- Auth is a `baseUrl` + `accessToken` (URL) + `userKey` (HTTP header) triple instead of a single
  `apiKey`, because that's how the new API is set up.
- The API call happens in `node_helper.js` (on the mirror's Node process) rather than directly from
  the browser, so your key never appears in the renderer/dev tools and there are no CORS concerns.
- Stops are objects (`{ atcoCode, label, routes }`) rather than bare strings/arrays, and routes are
  matched against `publicservicename` returned by the API.

## Prerequisites

You need API credentials from City of Edinburgh Council / Trapeze:

1. Go to <https://www.edinburghtraveltracker.com/> and use the **"API Keys"** link to register /
   request access.
2. Once approved you'll be issued a **BaseURL**, an **AccessToken**, and a **User_Key**. These map
   to `baseUrl`, `accessToken` and `userKey` below.
3. Read the [API licence and terms of use](https://www.edinburghtraveltracker.com/resources/docs/api_licence_and_terms_of_use.pdf) —
   notably, any app using this data must display "Data provided by City of Edinburgh Council"
   (this module does that by default via `showAttribution`), and keys go stale if unused for 12
   months.

## Installation

```bash
cd ~/MagicMirror/modules
git clone <this-repo> MMM-EdinburghBuses
cd MMM-EdinburghBuses
npm install
```

(No extra npm dependencies are required beyond what MagicMirror already provides — `node_helper.js`
uses the built-in `fetch`. `npm install` is a no-op unless you add packages later.)

## Configuration

Add to `config/config.js`:

```js
{
    module: 'MMM-EdinburghBuses',
    header: 'Buses',
    position: 'top_left',
    config: {
        baseUrl: 'https://<host-provided-by-CEC/Trapeze>',
        accessToken: '<ACCESS-TOKEN>',
        userKey: '<USER_KEY>',

        stops: [
            // Show every route at this stop
            { atcoCode: '6110114', label: 'Princes Street' },

            // Only show the 22 and N22 at this stop
            { atcoCode: '6110207', label: 'Home stop', routes: ['22', 'N22'] },

            // Stops can also be identified by SMS code instead of AtcoCode
            { smsCode: '12345678', label: 'Work stop', routes: ['30'] }
        ],

        updateInterval: 30,   // seconds between refreshes
        lookahead: 60,        // minutes of look-ahead requested from the API
        maxEvents: 3          // departures shown per route
    }
}
```

### Config reference

| Key | Description | Default | Required |
| --- | --- | --- | --- |
| `baseUrl` | Host for the Open API, as issued to you | `null` | Yes |
| `accessToken` | Access token path segment, as issued to you | `null` | Yes |
| `userKey` | The `User_Key` sent as a request header | `null` | Yes |
| `userKeyHeader` | Header name used to send `userKey` | `'User_Key'` | No |
| `stops` | Array of stop objects, see below | `[]` | Yes |
| `updateInterval` | Refresh interval, in seconds | `30` | No |
| `animationSpeed` | DOM update animation speed, in ms | `1000` | No |
| `lookahead` | Minutes of look-ahead requested from the API | `60` | No |
| `maxEvents` | Departures shown per route/stop | `3` | No |
| `eventType` | `'departure'` or `'arrival'` | `'departure'` | No |
| `timeFormat` | `'Local'` or `'UTC'` (should normally stay `'Local'`) | `'Local'` | No |
| `minVisitsPerService` | Passed straight to the API; see Open API guide §3.1 | `null` | No |
| `showStopName` | Show a header line with the stop's label above each stop's routes | `true` | No |
| `showAttribution` | Show the required "Data provided by City of Edinburgh Council" line | `true` | No |
| `maxRoutesPerStop` | Limit how many distinct routes are shown per stop | `null` (all) | No |
| `dueThresholdMinutes` | Departures at or below this many minutes show as "Due" | `1` | No |

### Stop object

| Key | Description | Required |
| --- | --- | --- |
| `atcoCode` | AtcoCode of the stop | Yes, unless `smsCode` given |
| `smsCode` | SMS code of the stop (alternative to `atcoCode`) | Yes, unless `atcoCode` given |
| `label` | Display name shown above the stop's departures | No (falls back to the name the API returns, then the code) |
| `routes` | Array of route/service numbers to include, e.g. `['22', 'N22']`. Omit to show all routes at that stop. | No |
| `maxEvents` | Per-stop override of the top-level `maxEvents` | No |

### Finding stop codes

- The old trick of clicking a stop on Google Maps to read its ID still generally works for
  AtcoCodes/NaPTAN codes in the UK.
- The Open API itself exposes `StopDetails`, `GetStops` and `GetFilteredStops` endpoints (see the
  [Open API guide](https://www.edinburghtraveltracker.com/resources/docs/open_api_guide.pdf)) which
  you can query with your credentials to look up codes and names if you'd rather not use Maps.

## Notes / limitations

- The `StopEvents` endpoint doesn't support server-side filtering by route number, so `routes`
  filtering happens after the fetch, per stop, in `node_helper.js`.
- Times come back from the API as local `HH:mm` strings rather than timestamps; the module works
  out a countdown from the mirror's current time, and assumes anything that looks more than 6 hours
  "in the past" actually belongs to the next day (post-midnight services).
- A `*` next to a time means it's a scheduled time, not a live/real-time one (i.e. `arrivaltime` /
  `departuretime` was null and the module fell back to `schedulearrivaltime` /
  `scheduledeparturetime`).
