"use strict";

/*
 * Created with @iobroker/create-adapter v2.1.1
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const axios = require("axios").default;
const Json2iob = require("./lib/json2iob");

class BoschEbikeconnect extends utils.Adapter {
    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: "bosch-ebikeconnect",
        });
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("unload", this.onUnload.bind(this));
        this.deviceArray = [];
        this.json2iob = new Json2iob(this);
        this.requestClient = axios.create();
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        // Reset the connection indicator during startup
        this.setState("info.connection", false, true);
        if (this.config.interval < 0.5) {
            this.log.info("Set interval to minimum 0.5");
            this.config.interval = 0.5;
        }
        if (!this.config.username || !this.config.password) {
            this.log.error("Please set username and password in the instance settings");
            return;
        }

        this.updateInterval = null;
        this.reLoginTimeout = null;
        this.refreshTokenTimeout = null;
        this.session = {};
        this.subscribeStates("*");

        await this.login();

        if (this.session.token_value) {
            await this.getDeviceList();
            await this.updateDevices();
            this.updateInterval = setInterval(async () => {
                await this.updateDevices();
            }, this.config.interval * 60 * 1000);
            this.refreshTokenInterval = setInterval(() => {
                this.refreshToken();
            }, 30 * 60 * 60 * 1000);
        }
    }
    async login() {
        await this.requestClient({
            method: "post",
            url: "https://www.ebike-connect.com/ebikeconnect/api/app/token/public",
            headers: {
                accept: "application/vnd.ebike-connect.com.v4+json, application/json",
                "content-type": "application/json",
                "cache-control": "no-store",
                "protect-from": "CSRF",
                "accept-language": "de-de",
                "user-agent": "oea_ios/4.8.1 (iPhone; iOS 14.8; Scale/3.00)",
            },
            data: JSON.stringify({
                mobile_id: "1B50636-3AC4-48B1-A851-63BAD39EAEC6",
                password: this.config.password,
                username: this.config.username,
            }),
        })
            .then((res) => {
                this.log.debug(JSON.stringify(res.data));
                this.setState("info.connection", true, true);
                this.session = res.data;
            })
            .catch((error) => {
                this.log.error(error);
                error.response && this.log.error(JSON.stringify(error.response.data));
            });
    }

    async getDeviceList() {
        await this.requestClient({
            method: "get",
            url: "https://www.ebike-connect.com/ebikeconnect/api/app/devices/my_ebikes",
            headers: {
                accept: "application/vnd.ebike-connect.com.v4+json, application/json",
                "accept-language": "de-de",
                "cache-control": "no-store",
                "protect-from": "CSRF",
                "user-agent": "oea_ios/4.8.1 (iPhone; iOS 14.8; Scale/3.00)",
                "x-authorization": +this.session.token_value,
            },
        })
            .then(async (res) => {
                this.log.debug(JSON.stringify(res.data));

                for (const device of res.data.my_ebikes) {
                    const id = device.id;

                    this.deviceArray.push(id);
                    const name = device.name;

                    await this.setObjectNotExistsAsync(id, {
                        type: "device",
                        common: {
                            name: name,
                        },
                        native: {},
                    });
                    await this.setObjectNotExistsAsync(id + ".remote", {
                        type: "channel",
                        common: {
                            name: "Remote Controls",
                        },
                        native: {},
                    });

                    const remoteArray = [{ command: "Refresh", name: "True = Refresh" }];
                    remoteArray.forEach((remote) => {
                        this.setObjectNotExists(id + ".remote." + remote.command, {
                            type: "state",
                            common: {
                                name: remote.name || "",
                                type: remote.type || "boolean",
                                role: remote.role || "boolean",
                                def: remote.def || false,
                                write: true,
                                read: true,
                            },
                            native: {},
                        });
                    });
                    this.json2iob.parse(id, device);
                }
            })
            .catch((error) => {
                this.log.error(error);
                error.response && this.log.error(JSON.stringify(error.response.data));
            });
    }

    async updateDevices() {
        const statusArray = [
            {
                path: "trips",
                url: "https://www.ebike-connect.com/ebikeconnect/api/app/activities/trip/headers?max=2&offset=1656314079759",
                desc: "Trips",
            },
            {
                path: "routes",
                url: "https://www.ebike-connect.com/ebikeconnect/api/app/navigation/my_items/routes?timestamp=0",
                desc: "Routes",
            },
            {
                path: "destinations",
                url: "https://www.ebike-connect.com/ebikeconnect/api/app/navigation/my_items/destinations?timestamp=0",
                desc: "Destinations",
            },
        ];

        for (const id of this.deviceArray) {
            for (const element of statusArray) {
                const url = element.url.replace("$id", id);

                await this.requestClient({
                    method: element.method || "get",
                    url: element.url,
                    headers: {
                        accept: "application/vnd.ebike-connect.com.v4+json, application/json",
                        "accept-language": "de-de",
                        "cache-control": "no-store",
                        "protect-from": "CSRF",
                        "user-agent": "oea_ios/4.8.1 (iPhone; iOS 14.8; Scale/3.00)",
                        "x-authorization": +this.session.token_value,
                    },
                })
                    .then(async (res) => {
                        this.log.debug(JSON.stringify(res.data));
                        if (!res.data) {
                            return;
                        }
                        const data = res.data;

                        const forceIndex = true;
                        const preferedArrayName = null;

                        this.json2iob.parse(id + "." + element.path, data, { forceIndex: forceIndex, preferedArrayName: preferedArrayName, channelName: element.desc });
                        await this.setObjectNotExistsAsync(id + "." + element.path + ".json", {
                            type: "state",
                            common: {
                                name: "Raw JSON",
                                write: false,
                                read: true,
                                type: "string",
                                role: "json",
                            },
                            native: {},
                        });
                        this.setState(id + "." + element.path + ".json", JSON.stringify(data), true);
                    })
                    .catch((error) => {
                        if (error.response) {
                            if (error.response.status === 401) {
                                error.response && this.log.debug(JSON.stringify(error.response.data));
                                this.log.info(element.path + " receive 401 error. Refresh Token in 60 seconds");
                                this.refreshTokenTimeout && clearTimeout(this.refreshTokenTimeout);
                                this.refreshTokenTimeout = setTimeout(() => {
                                    this.refreshToken();
                                }, 1000 * 60);

                                return;
                            }
                        }
                        this.log.error(url);
                        this.log.error(error);
                        error.response && this.log.error(JSON.stringify(error.response.data));
                    });
            }
        }
    }
    async refreshToken() {
        if (!this.session) {
            this.log.error("No session found relogin");
            await this.login();
            return;
        }
        await this.login();
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            this.setState("info.connection", false, true);
            this.refreshTimeout && clearTimeout(this.refreshTimeout);
            this.reLoginTimeout && clearTimeout(this.reLoginTimeout);
            this.refreshTokenTimeout && clearTimeout(this.refreshTokenTimeout);
            this.updateInterval && clearInterval(this.updateInterval);
            this.refreshTokenInterval && clearInterval(this.refreshTokenInterval);
            callback();
        } catch (e) {
            callback();
        }
    }

    /**
     * Is called if a subscribed state changes
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    async onStateChange(id, state) {
        if (state) {
            if (!state.ack) {
                const deviceId = id.split(".")[2];
                const command = id.split(".")[4];
                if (id.split(".")[3] !== "remote") {
                    return;
                }

                if (command === "Refresh") {
                    this.updateDevices();
                    return;
                }
            }
        }
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    module.exports = (options) => new BoschEbikeconnect(options);
} else {
    // otherwise start the instance directly
    new BoschEbikeconnect();
}
