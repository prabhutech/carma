(function ($) {
    Mojio = {
        Sandbox: "http://sandbox.api.moj.io/v1",
        Live: "http://api.moj.io/v1",
        Client: null
    };

    Mojio.EventTypes = [
        "Information",
        "MojioOn",
        "MojioOff",
        "MojioIdle",
        "MojioWake",
        "IgnitionOn",
        "IgnitionOff",
        "LowBattery",
        "TripEvent",
        "TripStatus",
        "OffStatus",
        "TowStart",
        "TowStop",
        "Accident",
        "FenceEntered",
        "FenceExited",
        "Warning",
        "MILWarning",
        "ConnectionLost",
        "Alert",
        "HardAcceleration",
        "HardRight",
        "HardLeft",
        "Speed",
        "Diagnostic",
        "Park",
        "Accelerometer",
        "Acceleration",
        "Deceleration",
        "HeadingChange"
    ];

    Mojio.Client = function (options) {
        var _this = this;
        var settings;
        var _token;

        var _user;

        var _conn;
        var _connStatus = null;
        var _hub;

        var _cachedValues = {};
        var _cachedCount = 0;

        var _logoutTimer;

        var _currentRequests = {};

        var loginRequest;

        var init = function (options) {
            settings = $.extend({
                'url': 'http://api.moj.io/v1',       // API endpoint
                'mojioTokenHeader': "MojioAPIToken", // Header name for Mojio Token
                'saveSession': false,                // Should session information be stored?
                'cookiePrefix': 'MojioTokenCookie',  // Session cookie name (if we are saving session state)
                'cookieDomain': document.domain,     // Session domain (if we are saving session state)
                'cacheEnabled': true,                // Enable caching of queries?
                'cachePrefix': 'MojioCache',         // Cache prefix
                'cacheMax': 25,                      // Max number of requests to store
                'keepAlive': 6,                      // Session keep alive in minutes (Should be less THAN sessionTime)
                'sessionTime': 24 * 60,              // Length of login session token keep alive
                'debug': false                       // Verbose debugging (to console.log)
            }, options);

            if (settings.debug && !console)
                // Silently disable logging?
                settings.debug = false;

            if (settings.cacheEnabled && typeof (Storage) == "undefined") {
                // Fallback incase no browser does not support LocalStorage.
                var _sessionStorage = {};
                window.sessionStorage = {
                    setItem: function (k, v) { _sessionStorage[k] = v + ""; },
                    removeItem: function (k) { delete _sessionStorage[k]; },
                    getItem: function (k) { return _sessionStorage[k]; },
                    clear: function () { delete _sessionStorage; _sessionStorage = {}; }
                };
            }

            _loadCached();

            if (settings.token) {
                _sendLoginRequest(getUrl("login", settings.token))
                    .fail(function () { $.error('Failed to initialize API.'); });
            } else {
                _loadSessionToken();
                if (getTokenId())
                    return;

                if (settings.appId == null || settings.secretKey == null)
                    throw new Exception("API key and secret key required.");

                var data = { secretKey: settings.secretKey };

                if (options.user && options.password) {
                    data["userOrEmail"] = options.user;
                    data["password"] = options.password;
                }

                _sendLoginRequest(getUrl("login", settings.appId, "begin"), data)
                .fail(function () { $.error('Failed to initialize API.'); });
            }
        }

        var log = function (object) {
            if (settings.debug)
                console.log(object);
        }

        var parseDate = function (str) {
            if (!str) return null;
            var dateISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[.,]\d+)?Z/i;

            // replacer RegExp
            var replaceISO = /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:[.,](\d+))?Z/i;

            var func = str.replace(replaceISO, "new Date(Date.UTC(parseInt('$1',10),parseInt('$2',10)-1,parseInt('$3',10),parseInt('$4',10),parseInt('$5',10),parseInt('$6',10),(function(s){return /*parseInt(s,10)||*/0;})('$7')))");
            return (new Function("return " + func))();
        }

        function _refreshToken(id) {
            if (!id)
                id = _token._id;

            _sendLoginRequest(getUrl("login", id, "extend"), { 'minutes': settings.keepAlive }, "GET")
                    .done(function (data) {
                        log('Session token has been refreshed.');
                    })
                    .fail(function () {
                        log("Failed to refresh token.");
                        setCookie(settings.cookiePrefix + "_id", null, new Date(0), settings.cookieDomain);
                    });
        }

        var _loadSessionToken = function () {
            if (!settings.saveSession) return;

            // Load token from cookie instead
            var tokenId = getCookie(settings.cookiePrefix + "_id");
            if (tokenId) {
                if (getCookie(settings.cookiePrefix + "_refresh") > new Date().getTime()) {
                    log('Loading token from previous session');
                    _token = {
                        _id: tokenId,
                        AppId: settings.appId,
                        UserId: getCookie(settings.cookiePrefix + "_user")
                    }
                } else {
                    log('Previous session has expired.');
                    _clearCached();
                }
            }
        }

        var _saveSessionToken = function (token) {
            if (!settings.saveSession) return;

            if (_logoutTimer) clearTimeout(_logoutTimer);
            _logoutTimer = setTimeout(_refreshToken, (settings.keepAlive - 1) * 60 * 1000);

            // Expires in 15 minutes
            var expires = new Date(new Date().getTime() + settings.keepAlive * 60000);
            var date = parseDate(token.ValidUntil);

            if (token.UserId)
                setCookie(settings.cookiePrefix + "_user", token.UserId, date, settings.cookieDomain);
            else
                setCookie(settings.cookiePrefix + "_user", null, new Date(0), settings.cookieDomain);

            setCookie(settings.cookiePrefix + "_refresh", expires, expires, settings.cookieDomain);

            if (!_token || _token._id != token._id)
                setCookie(settings.cookiePrefix + "_id", token._id, date, settings.cookieDomain);
        }

        var _cachedName = function (cacheId) {
            return settings.cachePrefix + "_" + cacheId;
        }

        var _hasCached = function (cacheId) {
            if (!settings.cacheEnabled)
                return;

            return cacheId in _cachedValues;
        }

        var _removeCached = function (cacheId, skipUpdate) {
            if (cacheId in _cachedValues) {
                sessionStorage.removeItem(_cachedName(cacheId));
                _cachedCount--;
                delete _cachedValues[cacheId];
            }
            if (!skipUpdate) _updateCached();
        }

        var _clearCached = function (match) {
            for (var prop in _cachedValues)
                if (!match || prop.indexOf(match) !== -1)
                    _removeCached(prop, true);

            log(match + ' cache cleared');
            _updateCached();
        }

        var _getCached = function (cacheId) {
            var string = sessionStorage.getItem(_cachedName(cacheId));

            return string ? JSON.parse(string) : null;
        }

        var _setCached = function (cacheId, value) {
            if (!settings.cacheEnabled)
                return;

            if (_cachedCount >= settings.cacheMax)
                _removeCached(_randProperty(_cachedValues), true);

            _cachedValues[cacheId] = true;
            _cachedCount++;
            _updateCached();

            var string = JSON.stringify(value);
            return sessionStorage.setItem(_cachedName(cacheId), string);
        }

        function _randProperty(obj) {
            var result;
            var count = 0;
            for (var prop in obj)
                if (Math.random() < 1 / ++count)
                    result = prop;
            return result;
        }

        var _updateCached = function () {
            sessionStorage.setItem(settings.cachePrefix + "Values", JSON.stringify(_cachedValues));
            sessionStorage.setItem(settings.cachePrefix + "Count", _cachedCount);
        }

        var _loadCached = function () {
            var string = sessionStorage.getItem(settings.cachePrefix + "Values");
            if (string)
                try {
                    _cachedValues = JSON.parse(string);
                } catch (e) {
                }

            _cachedCount = sessionStorage.getItem(settings.cachePrefix + "Count");
            if (!_cachedCount) _cachedCount = 0;
        }

        var setToken = function (token) {
            var currentStatus = isLoggedIn();

            _saveSessionToken(token);
            _token = token;

            // Update event status
            if (isLoggedIn() && !currentStatus)
                $(_this).trigger('mojioLogin');
            else if (!isLoggedIn() /*&& currentStatus*/)
                $(_this).trigger('mojioLogout');

            // Clear saved user if user has changed.
            if (_user && _user._id != getUserId())
                _user = null;

            // TODO: perhaps we should do this more frequently?
            // Clear cache if credentials changed.
            _clearCached();

            return this;
        }

        var getTokenId = function () {
            if (_token)
                return _token._id;
            return null;
        }

        var getUserId = function () {
            if (_token)
                return _token.UserId;
            return null;
        }

        var getUrl = function (controller, id, action, key) {
            if (key && id && action)
                return settings.url + "/" + encodeURIComponent(controller) + "/" + encodeURIComponent(id) + "/" + encodeURIComponent(action) + "/" + encodeURIComponent(action);
            else if (id && action)
                return settings.url + "/" + encodeURIComponent(controller) + "/" + encodeURIComponent(id) + "/" + encodeURIComponent(action);
            else if (id)
                return settings.url + "/" + encodeURIComponent(controller) + "/" + encodeURIComponent(id);
            else if (action)
                return settings.url + "/" + encodeURIComponent(controller) + "/" + encodeURIComponent(action);

            return settings.url + "/" + encodeURIComponent(controller);
        }

        var dataByMethod = function (data, method) {
            switch (method.toUpperCase()) {
                case 'POST':
                case 'PUT':
                    return JSON.stringify(data);
                default:
                    return data;
            }
        }

        var sendRequest = function (url, data, method) {
            if (!method)
                method = "GET";

            if (!data)
                data = {};

            var headers = {};
            if (getTokenId() != null)
                headers[settings.mojioTokenHeader] = getTokenId();

            return $.ajax(url, {
                data: dataByMethod(data, method),
                headers: headers,
                contentType: "application/json",
                type: method,
                cache: false,
                error: function (obj, status, error) {
                    log('Error during request: (' + status + ') ' + error);
                }
            });
        }

        var _sendLoginRequest = function (url, data, method) {
            if (loginRequest) {
                var r;
                loginRequest.done(function () { r = _sendLoginRequest(url, data, method); });

                var done = function (func) {
                    if (r) r.done(func);
                    else loginRequest.done(function () { done(func) });
                }

                var fail = function (func) {
                    if (r) r.fail(func);
                    else loginRequest.done(function () { fail(func) });
                }

                return {
                    done: done,
                    fail: fail
                }
            }

            loginRequest = sendRequest(url, data, method)
                .done(function (token) {
                    setToken(token);

                    loginRequest = null;
                })
                .fail(function () {
                    loginRequest = null;
                    log('Failed to login');
                });

            return loginRequest;
        }

        var login = function (userOrEmail, password) {
            if (!userOrEmail || !password)
                $.error("Must supply an email and password");

            var data = { password: password, minutes: settings.sessionTime };

            return _sendLoginRequest(getUrl("login", userOrEmail, "setuser"), data);
        }

        var oAuthLogin = function (accessToken, expiresIn, signedRequest, userID) {
            if (isLoggedIn())
                return;

            if (!accessToken || !expiresIn || !signedRequest || !userID)
                $.error("Invalid OAuth login");

            var data = { accessToken: accessToken, expiresIn: expiresIn, signedRequest: signedRequest, userID: userID };

            return _sendLoginRequest(getUrl("login", "0", "setExternalUser"), data);
        }

        var logout = function () {
            return _sendLoginRequest(getUrl("login", getUserId(), "logout"));
        }

        var getCurrentUser = function (func) {
            if (_user)
                func(_user);
            else if (isLoggedIn())
                get('users', getUserId())
                    .done(function (user) {
                        if (!user)
                            return;

                        if (getUserId() == user._id)
                            _user = user;

                        func(_user);
                    });
            else
                return false;

            return true;
        }

        var get = function (type, id, action, page, pageSize, sortBy, desc) {
            var url = getUrl(type, id, action);

            var cacheId;
            var isCachable = ((!page || page < 15) && (!pageSize || pageSize < 15));

            if (isCachable)
                cacheId = url
                    + "?page=" + page
                    + "&size=" + pageSize
                    + "&sort=" + sortBy
                    + "&desc=" + (desc ? 'true' : 'false');

            // Load from cache
            if (isCachable && _hasCached(cacheId))
                return {
                    done: function (func) { func(_getCached(cacheId)); return this; },
                    fail: function (func) { return this; }
                }
            else if (isCachable && _currentRequests[cacheId])
                return _currentRequests[cacheId];


            var data = {};
            if (page) data.offset = (page - 1) * pageSize;
            if (pageSize) data.limit = pageSize;
            if (sortBy) data.sortBy = sortBy;
            if (desc) data.desc = true;

            // perform request
            request = sendRequest(url, data);

            // Save cache
            if (isCachable) {
                _currentRequests[cacheId] = request;

                request.done(function (data) {
                    data.Id = data._id;
                    _setCached(cacheId, data);

                    delete _currentRequests[cacheId];
                });
            }

            return request;
        }

        var post = function (type, id, action, data) {
            var url = getUrl(type, id, action);
            return sendRequest(url, data, "POST").done(_clearCached(type));
        }

        var put = function (type, id, action, data) {
            var url = getUrl(type, id, action);
            return sendRequest(url, data, "PUT").done(_clearCached(type));
        }

        var insert = function (type, data, action) {
            if (data.Id)
                data._id = data.Id;

            return post(type, data._id, action, data);
        }

        var save = function (type, data, action) {
            if (data.Id)
                data._id = data.Id;

            if (!data._id)
                return insert(type, data, action);

            return put(type, data._id, action, data);
        }

        var del = function (type, data, action) {
            var id = data;
            if (typeof data === "object") {
                if (data._id)
                    id = data._id;
                else if (data.Id)
                    id = data.Id;
            }

            var url = getUrl(type, id, action);
            return sendRequest(url, null, "DELETE").done(_clearCached(type));
        }

        var store = function (type, id, key, value) {
            var action = "store";
            var url = getUrl(type, id, action, key);
            if (value == null)
                return sendRequest(url);

            return sendRequest(url, value, "PUT").done(_clearCached(type));
        }

        var send = function (type, id, action, data, method) {
            var url = getUrl(type, id, action);

            return sendRequest(url, data, method);
        }

        var subscribe = function (type, ids, groups) {
            var hub = getHub();

            if (!groups)
                groups = Mojio.EventTypes;

            if (hub.connection.state != 1) {
                if (_connStatus)
                    _connStatus.done(function () { subscribe(type, ids, groups) });
                else
                    _connStatus = hub.connection.start().done(function () { subscribe(type, ids, groups) });

                return _connStatus;
            }

            var action = (ids instanceof Array) ? "Subscribe" : "SubscribeOne";

            return hub.invoke(action, getTokenId(), type, ids, groups);
        }

        var unsubscribe = function (type, ids, groups) {
            var hub = getHub();

            if (!groups)
                groups = Mojio.EventTypes;

            if (hub.connection.state != 1) {
                if (_connStatus)
                    _connStatus.done(function () { unsubscribe(type, ids, groups) });
                else
                    _connStatus = hub.connection.start().done(function () { unsubscribe(type, ids, groups) });

                return _connStatus;
            }

            return hub.invoke("Unsubscribe", getTokenId(), type, ids, groups);
        }

        var getHub = function () {
            if (_hub)
                return _hub;

            _conn = $.hubConnection(settings.url + "/signalr", { useDefaultPath: false });
            _hub = _conn.createHubProxy('hub');

            _hub.on("error", function (data) {
                log(data);
            });

            _connStatus = _conn.start().done(function () { _connStatus = null; });

            return _hub;
        }

        function isLoggedIn() {
            return getUserId() != null;
        }

        function _dtGetKey(aoData, sKey) {
            for (var i = 0, iLen = aoData.length ; i < iLen ; i++) {
                if (aoData[i].name == sKey) {
                    return aoData[i].value;
                }
            }
            return null;
        }

        function dataTableRenderDate(data, type, row) {
            var date = parseDate(data);

            if (!date || date.getFullYear() < 1970)
                return "Never";

            return date.toDateString();
        }

        function dataTableHandler(sSource, aoData, callback) {
            var s = sSource.split("/");

            var controller = s.length >= 1 ? s[1] : s[0];
            var id = s.length >= 2 ? s[2] : null;
            var action = s.length >= 3 ? s[3] : null;

            _dtHanldeRequest(controller, id, action, aoData, callback);
        }

        function _dtHanldeRequest(controller, id, action, aoData, callback) {

            var pageSize = _dtGetKey(aoData, 'iDisplayLength');
            var start = _dtGetKey(aoData, 'iDisplayStart');

            var sortCol = _dtGetKey(aoData, 'iSortCol_0');
            var sortDesc = _dtGetKey(aoData, 'sSortDir_0') == "desc";

            var sortBy = _dtGetKey(aoData, 'mDataProp_' + sortCol);
            var page = (start > 0) ? (start / pageSize) + 1 : 1;

            get(controller, id, action, page, pageSize, sortBy, sortDesc).done(function (response) {
                var json = {
                    sEcho: _dtGetKey(aoData, 'sEcho'),
                    iTotalRecords: response.TotalRows,
                    iTotalDisplayRecords: response.TotalRows,
                    aaData: response.Data
                };

                callback(json);
            });
        }


        init(options);

        var public = {
            login: login,
            oAuthLogin: oAuthLogin,
            userId: getUserId,
            isLoggedIn: isLoggedIn,
            logout: logout,
            getCurrentUser: getCurrentUser,
            get: get,
            post: post,
            put: put,
            del: del,
            insert: insert,
            save: save,
            send: send,
            store: store,
            subscribe: subscribe,
            unsubscribe: unsubscribe,
            parseDate: parseDate,
            onLogin: function (func) {
                if (isLoggedIn() && !loginRequest)
                    // IF already logged in, exec function
                    func();

                $(_this).bind('mojioLogin', func);
                return public;
            },
            onLogout: function (func) {
                if (!isLoggedIn() && !loginRequest)
                    // IF already logged out, exec function
                    func();

                $(_this).bind('mojioLogout', func);
                return public;
            },
            onEvent: function (func) {
                getHub().on("event", func);
            },
            ready: function (func) {
                $(function () {
                    if (!loginRequest)
                        func();
                    else
                        loginRequest.done(func);
                });

                return public;
            },
            dataTableHandler: dataTableHandler,
            dataTableRenderDate: dataTableRenderDate
        }

        return public;
    }

    if (typeof exports !== 'undefined') {
        // Github = exports;
        module.exports = Mojio;
    } else {
        window.Mojio = Mojio;
    }
})(jQuery);


// Helper functions
function getCookie(c_name) {
    var c_value = document.cookie;
    var c_start = c_value.indexOf(" " + c_name + "=");
    if (c_start == -1) {
        c_start = c_value.indexOf(c_name + "=");
    }
    if (c_start == -1) {
        c_value = null;
    }
    else {
        c_start = c_value.indexOf("=", c_start) + 1;
        var c_end = c_value.indexOf(";", c_start);
        if (c_end == -1) {
            c_end = c_value.length;
        }
        c_value = unescape(c_value.substring(c_start, c_end));
    }
    return c_value;
}

function setCookie(c_name, v, expires, domain) {
    var c_value = escape(v) + "; path=/"
        + ((expires == null) ? "; expires=" + new Date(new Date().getTime() + 5 * 60000).toUTCString() : "; expires=" + expires.toUTCString())
        + ((domain == null) ? "" : "; domain=" + domain);

    document.cookie = c_name + "=" + c_value;
}
