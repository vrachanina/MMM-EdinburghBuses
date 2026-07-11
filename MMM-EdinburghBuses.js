/* MagicMirror Module: MMM-EdinburghBuses
 *
 * Displays real-time bus departures for specified Edinburgh (Lothian /
 * partner operator) bus stops and, optionally, specific route numbers.
 *
 * Data source: Edinburgh Travel Tracker Open API (NOVUS-RT), i.e. the
 * successor to the old mybustracker / tfe-opendata API used by the
 * now-unsupported MMM-LothianBuses module.
 *
 * You need credentials issued by City of Edinburgh Council / Trapeze:
 *   - baseUrl      (host for the Open API, provided on registration)
 *   - accessToken  (path segment used to authenticate the request)
 *   - userKey      (sent as an HTTP header on every request)
 * Request these via the "API Keys" link on
 * https://www.edinburghtraveltracker.com/
 *
 * Per the API licence terms, any app using this data must display:
 *   "Data provided by City of Edinburgh Council"
 * This module shows that attribution in its footer by default.
 */

Module.register("MMM-EdinburghBuses", {
    defaults: {
        // --- Credentials (required) ---
        baseUrl: null,
        accessToken: null,
        userKey: null,
        userKeyHeader: "User_Key",

        // --- Stops to display (required) ---
        // Each entry:
        //   { atcoCode: '6110114', label: 'Princes Street', routes: ['22','30'] }
        //   { smsCode: '12345678', routes: ['N22'] }
        // 'routes' is optional; omit it to show every service at that stop.
        stops: [],

        // --- Behaviour ---
        updateInterval: 30, // seconds between refreshes
        animationSpeed: 1000,
        lookahead: 60, // minutes of look-ahead requested from the API
        maxEvents: 3, // departures shown per route, per stop (also per-stop override)
        eventType: "departure", // 'departure' or 'arrival'
        timeFormat: "Local", // 'Local' or 'UTC' - keep 'Local' unless your server is on UTC
        minVisitsPerService: null,

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
        if (!this.config.baseUrl || !this.config.accessToken || !this.config.userKey) {
            this.isError = true;
            this.errorMessage = "Module not configured. Please specify baseUrl, accessToken and userKey.";
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

    // Turn an "HH:mm" string (today, possibly rolling into tomorrow) into
    // a countdown in minutes from now.
    minutesUntil: function (hhmm) {
        if (!hhmm) {
            return null;
        }
        const parts = hhmm.split(":");
        if (parts.length < 2) {
            return null;
        }
        const target = moment().seconds(0).milliseconds(0).hour(parseInt(parts[0], 10)).minute(parseInt(parts[1], 10));
        const now = moment();
        // If the time looks like it's already well in the past, assume it's
        // for after midnight and roll it forward a day.
        if (target.diff(now, "minutes") < -360) {
            target.add(1, "day");
        }
        return target.diff(now, "minutes");
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
    // sorted by soonest departure, mirroring the layout of the original
    // MMM-LothianBuses module.
    groupByRoute: function (events) {
        const byRoute = {};
        events.forEach((event) => {
            const route = event.publicservicename || "?";
            const time = event.departuretime || event.scheduledeparturetime || event.arrivaltime || event.schedulearrivaltime;
            const isLive = !!(event.departuretime || event.arrivaltime);
            const mins = this.minutesUntil(time);
            if (mins === null) {
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
        if (!anyEvents) {
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
                const maxPerRoute = this.config.maxEvents;
                const departures = routeGroup.departures.slice(0, maxPerRoute);

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
