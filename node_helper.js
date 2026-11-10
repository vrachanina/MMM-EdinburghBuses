/* MMM-EdinburghBuses / node_helper.js
 *
 * Talks to the City of Edinburgh Council Open API (Trapeze / Azure API
 * Management gateway) on behalf of the front-end module.
 *
 * Endpoint used:
 *   GET {baseUrl}/stops/StopEvents?smsCode=...&eventType=departure&...
 *   Header: <userKeyHeader>: <userKey>      (default Ocp-Apim-Subscription-Key)
 *
 * where baseUrl is e.g.
 *   https://apim-public.trapezegroupazure.co.uk/edinburgh-cec-openapi/generic/v1.1
 *
 * Note: module config is delivered to the browser before it is passed to this
 * helper, so userKey is not hidden from the page itself. Keep ipWhitelist
 * restricted to loopback while a real key is in config.js.
 */

const NodeHelper = require("node_helper");

module.exports = NodeHelper.create({
    start: function () {
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
        const params = new URLSearchParams();

        if (stop.atcoCode) {
            params.set("atcoCode", stop.atcoCode);
        } else if (stop.smsCode) {
            params.set("smsCode", stop.smsCode);
        }

        params.set("eventType", config.eventType || "departure");
        params.set("lookahead", String(config.lookahead || 60));
        // Ask for plenty; the front end limits how many are shown per route
        params.set("maxEvents", String(stop.maxEvents || config.fetchMaxEvents || 20));
        params.set("doCountdown", "true");
        if (config.minVisitsPerService) {
            params.set("minVisitsPerService", String(config.minVisitsPerService));
        }
        if (config.timeFormat) {
            params.set("timeFormat", config.timeFormat);
        }

        return `${base}/stops/StopEvents?${params.toString()}`;
    },

    fetchStop: async function (config, stop) {
        const stopId = stop.atcoCode || stop.smsCode;
        const url = this.buildUrl(config, stop);
        const headers = { Accept: "application/json" };
        headers[config.userKeyHeader || "Ocp-Apim-Subscription-Key"] = config.userKey;

        const response = await fetch(url, {
            method: "GET",
            headers: headers,
            signal: AbortSignal.timeout(15000)
        });

        if (!response.ok) {
            console.error(`[${this.name}] HTTP ${response.status} for stop ${stopId}`);
            throw new Error(`HTTP ${response.status} for stop ${stopId}`);
        }

        const json = await response.json();

        // The API returns an array of stop objects (several for a stop group)
        const stopObjs = Array.isArray(json) ? json : [json];
        let events = stopObjs.flatMap((s) => (Array.isArray(s && s.events) ? s.events : []));
        events = events.filter((e) => e.status !== "cancelled");
        const apiName = stopObjs[0] && stopObjs[0].name ? stopObjs[0].name : null;

        if (config.debug && events.length > 0) {
            console.log(`[${this.name}] first event for ${stopId}: ${JSON.stringify(events[0])}`);
        }

        // Optional filtering to specific route numbers, e.g. routes: ['49', 'N26']
        if (Array.isArray(stop.routes) && stop.routes.length > 0) {
            const wanted = stop.routes.map((r) => String(r).toUpperCase());
            events = events.filter((e) => wanted.includes(String(e.publicservicename).toUpperCase()));
        }

        return {
            atcoCode: stop.atcoCode || null,
            smsCode: stop.smsCode || null,
            label: stop.label || apiName || stopId,
            stopName: apiName,
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
