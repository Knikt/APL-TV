/* ============================================================
   APL TV's helper on LG TVs (webOS JS service com.knikt.apltv.service).
   The same helper as on Samsung (service.js, copied next to this file by
   tools/make-webos.py): the phone setup page behind the QR code, TV guides,
   providers without CORS. Here it starts when the app calls "start", and
   stays awake while the app is subscribed to it (webOS stops idle services
   after a few seconds).
   ============================================================ */
"use strict";

global.APLTV_PLATFORM = "webOS";
var Service = require("webos-service");
var helper = require("./service.js");

var service = new Service("com.knikt.apltv.service");
var keep = null, listeners = {};

function stayAwake() {
    if (keep) return;
    try {
        service.activityManager.create("keepAlive", function (activity) { keep = activity; });
    } catch (e) {}
}
function maybeSleep() {
    if (Object.keys(listeners).length || !keep) return;
    try { service.activityManager.complete(keep, function () {}); } catch (e) {}
    keep = null;
}

var start = service.register("start", function (message) {
    helper.start();
    stayAwake();
    if (message.isSubscription) {
        listeners[message.uniqueToken] = message;
        message.respond({ returnValue: true, subscribed: true, port: 8765 });
    } else {
        message.respond({ returnValue: true, port: 8765 });
    }
});
start.on("cancel", function (message) {
    delete listeners[message.uniqueToken];
    maybeSleep();
});

service.register("ping", function (message) { message.respond({ returnValue: true }); });
