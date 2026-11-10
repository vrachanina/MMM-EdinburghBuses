/* MagicMirror Module: MMM-EdinburghBuses
 *
 * Displays real-time bus departures for specified Edinburgh bus stops and,
 * optionally, specific route numbers.
 *
 * Data source: City of Edinburgh Council Open API (Trapeze / Azure API
 * Management gateway). You need:
 *   - baseUrl  e.g. https://apim-public.trapezegroupazure.co.uk/edinburgh-cec-openapi/generic/v1.1
 *   - userKey  your API subscription key
 * and, if the header differs from the default, userKeyHeader.
 * Request access via the "API Keys" link on https://www.edinburghtraveltracker.com/
 *
 * Per the API licence terms, any app using this data must display:
 *   "Data provided by City of Edinburgh Council"
 * This module shows that attribution in its footer by default.
 */

Module.register("MMM-EdinburghBuses", {
    defaults: {
        // --- Credentials (required) ---
        baseUrl: null,
        userKey: null,
        userKeyHeader: "Ocp-Apim-Subscription-Key",

        // --- Stops to display (required) ---
        // Each entry:
        //   { smsCode: '36232943', label: 'Wakefield Avenue', routes: ['49'] }
        //   { atcoCode: '6200241370', label: 'Wakefield Avenue' }
        // 'routes' is optional; omit it to show every service at that stop.
        stops: [],

        // --- Behaviour ---
        updateInterval: 30, // seconds between refreshes
        animationSpeed: 1000,
        lookahead: 60, // minutes of look-ahead requested from the API
        fetchMaxEvents: 20, // events requested per stop (can be overridden per stop with maxEvents)
        maxEvents: 3, // departures shown per route, per stop
        eventType: "departure", // 'departure' or 'arrival'
        timeFormat: null, // only sent to the API if set
        minVisitsPerService: null,
        debug: false, // log the first raw event per stop in the MagicMirror log

        // --- Display ---
        showStopName: true,
        showAttribution: true,
        maxRoutesPerStop: null, // null = show all routes returned for a stop
        dueThresholdMinutes: 1 // <= this many minutes is shown as "Due"
    },

    requiresVersion: "2.1.0",

    start: function () {
        this.results = [];
        this.loaded = false;
        this.isError = false;
        this.errorMessage = "";
        this.sendConfigAndFetch();
        setInterval(() => {
            this.sendConfigAndFetch();
        }, this.config.updateInterval * 1000);
    },

    getScripts: function () {
        return ["moment.js"];
    },

    getStyles: function () {
        return ["font-awesome.css", "MMM-EdinburghBuses.css"];
    },

    sendConfigAndFetch: function () {
        if (!this.config.baseUrl || !this.config.userKey) {
            this.isError = true;
            this.errorMessage = "Module not configured. Please specify baseUrl and userKey.";
            this.updateDom(this.config.animationSpeed);
            return;
        }
        if (!Array.isArray(this.config.stops) || this.config.stops.length === 0) {
            this.isError = true;
            this.errorMessage = "Module not configured. Please specify at least one stop.";
            this.updateDom(this.config.animationSpeed);
            return;
        }
        this.sendSocketNotification("EDINBURGHBUSES_FETCH", this.config);
    },

    socketNotificationReceived: function (notification, payload) {
        if (notification === "EDINBURGHBUSES_DATA") {
            this.results = payload.results;
            this.loaded = true;
            this.isError = false;
            this.errorMessage = "";
            this.updateDom(this.config.animationSpeed);
        }
    },

    // Convert an API time value into minutes from now. Handles:
    //   - a number: seconds from now (live times inside the countdown window)
    //   - "HH:mm": a time today (rolled to tomorrow if it looks like after midnight)
    //   - any other string: parsed as a date-time
    minutesUntil: function (value) {
        if (value === null || value === undefined || value === "") {
            return null;
        }

        if (typeof value === "number") {
            return Math.round(value / 60);
        }

        if (typeof value !== "string") {
            return null;
        }

        if (/^\d{1,2}:\d{2}$/.test(value)) {
            const parts = value.split(":");
            const target = moment()
                .seconds(0)
                .milliseconds(0)
                .hour(parseInt(parts[0], 10))
                .minute(parseInt(parts[1], 10));
            const now = moment();
            // If the time looks well in the past, assume it is after midnight
            if (target.diff(now, "minutes") < -360) {
                target.add(1, "day");
            }
            return target.diff(now, "minutes");
        }

        const parsed = moment(value);
        return parsed.isValid() ? parsed.diff(moment(), "minutes") : null;
    },

    formatMinutes: function (mins) {
        if (mins === null) {
            return this.translate("N/A");
        }
        if (mins <= this.config.dueThresholdMinutes) {
            return this.translate("Due");
        }
        return `${mins}`;
    },

    // Group a stop's flat event list by route number (publicservicename),
    // sorted by soonest departure.
    groupByRoute: function (events) {
        const isArrival = this.config.eventType === "arrival";
        const byRoute = {};

        events.forEach((event) => {
            const route = event.publicservicename || "?";
            const liveRaw = isArrival ? event.arrivaltime : event.departuretime;
            const schedRaw = isArrival ? event.schedulearrivaltime : event.scheduledeparturetime;
            const isLive = typeof liveRaw === "number" || (typeof liveRaw === "string" && liveRaw !== "");
            const mins = this.minutesUntil(isLive ? liveRaw : schedRaw);

            // Skip events with no usable time, or scheduled-only ones already gone
            if (mins === null || (!isLive && mins < -1)) {
                return;
            }
            if (!byRoute[route]) {
                byRoute[route] = [];
            }
            byRoute[route].push({
                destination: event.destination,
                mins: mins,
                isLive: isLive
            });
        });

        const routes = Object.keys(byRoute).map((route) => {
            const departures = byRoute[route].sort((a, b) => a.mins - b.mins);
            return { route, departures };
        });

        routes.sort((a, b) => a.departures[0].mins - b.departures[0].mins);

        if (this.config.maxRoutesPerStop) {
            return routes.slice(0, this.config.maxRoutesPerStop);
        }
        return routes;
    },

    getDom: function () {
        const wrapper = document.createElement("div");
        wrapper.className = "edinburgh-buses";

        if (this.isError) {
            wrapper.className = "thin small dimmed";
            wrapper.innerHTML = this.translate(this.errorMessage);
            return wrapper;
        }

        if (!this.loaded) {
            wrapper.className = "light small dimmed";
            wrapper.innerHTML = this.translate("Loading...");
            return wrapper;
        }

        const anyEvents = this.results.some((r) => r.events && r.events.length > 0);
        const anyErrors = this.results.some((r) => r.error);
        if (!anyEvents && !anyErrors) {
            wrapper.className = "light small dimmed";
            wrapper.innerHTML = this.translate("No buses");
            return wrapper;
        }

        this.results.forEach((stopResult) => {
            const stopBlock = document.createElement("div");
            stopBlock.className = "stop-block";

            if (stopResult.error) {
                const warn = document.createElement("div");
                warn.className = "light xsmall dimmed";
                warn.innerHTML = `<i class="fas fa-exclamation-triangle"></i> <em>${stopResult.label}: ${this.translate("unavailable")}</em>`;
                stopBlock.appendChild(warn);
                wrapper.appendChild(stopBlock);
                return;
            }

            if (this.config.showStopName) {
                const stopName = document.createElement("div");
                stopName.className = "stop-name xsmall light dimmed";
                stopName.innerText = stopResult.label;
                stopBlock.appendChild(stopName);
            }

            const routes = this.groupByRoute(stopResult.events);

            if (routes.length === 0) {
                const none = document.createElement("div");
                none.className = "light xsmall dimmed";
                none.innerHTML = this.translate("No buses");
                stopBlock.appendChild(none);
            }

            routes.forEach((routeGroup) => {
                const departures = routeGroup.departures.slice(0, this.config.maxEvents);

                const row = document.createElement("div");
                row.className = "bus";

                const busNumber = document.createElement("div");
                busNumber.className = "bus-number";
                busNumber.innerHTML = `<span class="number light medium">${routeGroup.route}</span>`;

                const destination = document.createElement("span");
                destination.className = "light xsmall light";
                destination.innerText = departures[0].destination || "";
                busNumber.appendChild(destination);
                row.appendChild(busNumber);

                const busTimes = document.createElement("div");
                busTimes.className = "bus-times";

                const first = departures[0];
                const busTimeMain = document.createElement("div");
                busTimeMain.className = `bus-time-main medium thin ${first.isLive ? "bright" : "dimmed"}`;
                const mainLabel = this.formatMinutes(first.mins);
                const mainParts = [`<span><strong>${mainLabel}${!first.isLive ? "<sup>*</sup>" : ""}</strong></span>`];
                if (first.mins > this.config.dueThresholdMinutes) {
                    mainParts.push(`<span>${this.translate("mins")}</span>`);
                }
                busTimeMain.innerHTML = mainParts.join(" ");
                busTimes.appendChild(busTimeMain);

                const rest = departures.slice(1);
                const busTimeNext = document.createElement("div");
                busTimeNext.className = "bus-time-next xsmall light";
                if (rest.length > 0) {
                    busTimeNext.innerHTML = `${this.translate("then in")} ${rest
                        .map((d) => `<strong>${this.formatMinutes(d.mins)}</strong>`)
                        .join(", ")} ${this.translate("mins")}`;
                } else {
                    busTimeNext.innerHTML = this.translate("not available");
                }
                busTimes.appendChild(busTimeNext);
                row.appendChild(busTimes);

                stopBlock.appendChild(row);
            });

            wrapper.appendChild(stopBlock);
        });

        if (this.config.showAttribution) {
            const attribution = document.createElement("div");
            attribution.className = "attribution xsmall dimmed";
            attribution.innerText = "Data provided by City of Edinburgh Council";
            wrapper.appendChild(attribution);
        }

        return wrapper;
    }
});
