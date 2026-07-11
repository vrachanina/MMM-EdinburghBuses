/* MMM-EdinburghBuses / node_helper.js
 *
 * Talks to the Edinburgh Travel Tracker (NOVUS-RT) Open API on behalf of the
 * front-end module. Doing the HTTP calls here (rather than in the browser)
 * keeps the User_Key out of dev tools / the DOM and avoids any CORS issues.
 *
 * Relevant endpoint (see "Open API Guide", section 3 - StopEvents):
 *   GET /{BaseUrl}/{AccessToken}/StopEvents?AtcoCode=...&EventType=departure...
 *   Header: <userKeyHeader>: <User_Key>
 */

const NodeHelper = require("node_helper");

module.exports = NodeHelper.create({
    start: function () {
        this.fetchInFlight = {};
        console.log(`[${this.name}] node_helper started`);
    },

    socketNotificationReceived: function (notification, payload) {
        if (notification === "EDINBURGHBUSES_FETCH") {
            this.fetchAllStops(payload);
        }
    },

    // Build the StopEvents URL for a single stop
    buildUrl: function (config, stop) {
        const base = config.baseUrl.replace(/\/+$/, "");
        const token = config.accessToken;
        const params = new URLSearchParams();

        if (stop.atcoCode) {
            params.set("AtcoCode", stop.atcoCode);
        } else if (stop.smsCode) {
            params.set("SMSCode", stop.smsCode);
        }

        params.set("EventType", config.eventType || "departure");
        params.set("Lookahead", String(config.lookahead || 60));
        params.set("MaxEvents", String(stop.maxEvents || config.maxEvents || 8));
        if (config.minVisitsPerService) {
            params.set("MinVisitsPerService", String(config.minVisitsPerService));
        }
        params.set("TimeFormat", config.timeFormat || "Local");

        return `${base}/${token}/StopEvents?${params.toString()}`;
    },

    fetchStop: async function (config, stop) {
        const url = this.buildUrl(config, stop);
        const headers = {
            Accept: "application/json"
        };
        headers[config.userKeyHeader || "User_Key"] = config.userKey;

        const response = await fetch(url, { method: "GET", headers });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status} for stop ${stop.atcoCode || stop.smsCode}`);
        }

        const json = await response.json();
        let events = Array.isArray(json.events) ? json.events : [];

        // Optional client-side filtering to specific route/service numbers,
        // e.g. routes: ['22', '30', 'N22']
        if (Array.isArray(stop.routes) && stop.routes.length > 0) {
            const wanted = stop.routes.map((r) => String(r).toUpperCase());
            events = events.filter((e) => wanted.includes(String(e.publicservicename).toUpperCase()));
        }

        return {
            atcoCode: stop.atcoCode || null,
            smsCode: stop.smsCode || null,
            label: stop.label || json.name || stop.atcoCode || stop.smsCode,
            stopName: json.name || null,
            events: events,
            error: null
        };
    },

    fetchAllStops: async function (config) {
        const stops = Array.isArray(config.stops) ? config.stops : [];

        const results = await Promise.all(
            stops.map((stop) =>
                this.fetchStop(config, stop).catch((error) => ({
                    atcoCode: stop.atcoCode || null,
                    smsCode: stop.smsCode || null,
                    label: stop.label || stop.atcoCode || stop.smsCode,
                    stopName: null,
                    events: [],
                    error: error.message || String(error)
                }))
            )
        );

        this.sendSocketNotification("EDINBURGHBUSES_DATA", { results, fetchedAt: Date.now() });
    }
});
