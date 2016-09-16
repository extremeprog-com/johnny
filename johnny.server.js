var app = require('express')();
var http = require('http').Server(app);

var sockjs = require('sockjs');

require('core-os');


classes = {};

Core.registerRequestPoint('HTTPServer_InitModulesRq', {type: 'multi'});
Core.registerEventPoint  ('HTTPServer_Started');

classes.HTTPServer = {
    __init: function() {
        FireRequest(new HTTPServer_InitModulesRq, function() {

            var port = process.env.PORT || 80;

            http.listen(port, function() {
                console.log('listening on *:' + port);
            });
        });
    }
};

Core.registerEventPoint('SocketServer_ClientConnected');
Core.registerEventPoint('SocketServer_ClientDisconnected');
Core.registerEventPoint('SocketServer_ClientMessage');

classes.SocketServer = {
    clients: [],
    initServer: function() {
        CatchRequest(HTTPServer_InitModulesRq);

        return function(success, fail) {
            var sockjsServer = sockjs.createServer({ sockjs_url: 'http://cdn.jsdelivr.net/sockjs/1.0.1/sockjs.min.js' });
            sockjsServer.installHandlers(http, {prefix:'/echo'});
            sockjsServer.on('connection', function(socket) {
                var disconnect_cb;
                var client = {
                    socket: socket,
                    send: function(_type, data) {
                        socket.write(JSON.stringify({_type: _type, body: data}));
                    },
                    disconnectPromise: new Promise(function(res) {
                        disconnect_cb = res
                    })
                };

                FireEvent(new SocketServer_ClientConnected({
                    client: client
                }));

                socket.on('data', function(message) {
                    var msg = JSON.parse(message);
                    FireEvent(new SocketServer_ClientMessage({
                        _type: msg._type,
                        client: client,
                        data: msg.body
                    }));
                });

                socket.on('close', function() {
                    FireEvent(new SocketServer_ClientDisconnected({
                        client: client
                    }));
                    disconnect_cb && disconnect_cb();
                });

            });

            success();

        }
    }

};

Core.registerEventPoint('Browsers_BrowserConnected');
Core.registerEventPoint('Browsers_BrowserDisconnected');
Core.registerRequestPoint('BrowsersUser_SearchBrowserRq');
Core.registerRequestPoint('BrowsersUser_SendActionToBrowser');
Core.registerEventPoint('Browsers_ActionStarted');
Core.registerEventPoint('Browsers_ActionDone');
Core.registerEventPoint('Browsers_ActionFail');
Core.registerEventPoint('Browsers_ActionCancel');

classes.Browsers = {
    token2Browsers: {},
    id2Browser: {},
    registerBrowser() {
        var event = CatchEvent(SocketServer_ClientMessage);
        if(event._type == 'register_browser') {
            var Browser = event.client;
            Browser.token   = event.data.token;
            Browser.params  = event.data.params;
            Browser.id      = event.data.id;

            if(!this.token2Browsers[event.data.token]) {
                this.token2Browsers[event.data.token] = []
            }

            this.token2Browsers[event.data.token].push(Browser);
            this.id2Browser[Browser.id] = Browser;
            Browser.send('register_browser_success', { browser_id: Browser.id })
            FireEvent(new Browsers_BrowserConnected({Browser: Browser}));
        }
    },
    unregisterBrowser() {
        var event = CatchEvent(SocketServer_ClientDisconnected);
        var Browser = event.client;
        var array = this.token2Browsers[Browser.token];
        array.splice(array.indexOf(Browser), 1);
        FireEvent(new Browsers_BrowserDisconnected({Browser: Browser}));
    },
    searches: [],
    refreshSearch() {
        CatchEvent(Browsers_BrowserConnected);
        var search;
        while(search = this.searches.shift()) {
            search();
        }
    },
    searchBrowser() {
        var request = CatchRequest(BrowsersUser_SearchBrowserRq);

        var _this = this;

        return function(success, fail) {

            var continue_search = true, Browser;

            (function search() {
                if(Browser = find_browser_for_runner(request.token, request.params)) {
                    success({Browser: Browser});
                } else {
                    _this.searches.push(search)
                }
            })();

            request.cancelPromise.then(function() {
                continue_search = false;
            });

            function find_browser_for_runner(token, params) {

                if(!_this.token2Browsers[token]) {
                    return;
                }

                qq:
                for(var i = 0, Browser; Browser = _this.token2Browsers[token][i]; i++) {
                    for(var j in params) if (params.hasOwnProperty(j)) {
                        if(!Browser.params.hasOwnProperty(j) || params[j] != Browser.params[j]) {
                            continue qq;
                        }
                    }
                    break;
                }
                return Browser;
            }
        }
    },
    actionId2resultCb: {},
    executeInBrowser() {
        var request = CatchRequest(BrowsersUser_SendActionToBrowser);
        var Action = request.Action;
        var _this = this;
        return function(success, fail) {
            var Browser = _this.id2Browser[Action.browser_id];
            Browser.send('run_action', {action_id: Action.id, fn: Action.fn, args: Action.args});
            Browser.Action = Action;
            _this.actionId2resultCb[Action.id] = function(event) {
                success({event: event})
            };
        }
    },
    catchActionResult() {
        var event = CatchEvent(Browsers_ActionStarted, SocketServer_ClientMessage, Browsers_BrowserConnected, Browsers_BrowserDisconnected);

        if(event instanceof SocketServer_ClientMessage) {
            if(event._type == 'run_action_done') {
                FireEvent(Browsers_ActionDone({
                    action_id: event.data.action_id,
                    result: event.data.result
                }))
            }
            if(event._type == 'run_action_fail') {
                FireEvent(Browsers_ActionFail({
                    action_id: event.data.action_id,
                    exception_descriptor: event.data.exception_descriptor,
                    line: event.data.line
                }))
            }
        }
    },
    applyActionResult() {
        var event = CatchEvent(Browsers_ActionDone, Browsers_ActionFail, Browsers_ActionCancel);

        var cb = this.actionId2resultCb[event.action_id];

        if(cb) {
            cb(event);
        } else {
            console.error('Wrong action done usage');
        }
    }
};


classes.Runners = {
    Actions: {},
    registerActionAndReturnActionIdAndExecuteAction: function() {
        var event = CatchEvent(SocketServer_ClientMessage);
        if(event._type == 'run_action') {
            var Action = {
                id: Math.random().toString(32).substr(2),
                client: event.client,
                browser_id: event.data.browser_id,
                fn: event.data.fn,
                args: event.data.args
            };
            this.Actions[Action.id] = Action;
            event.client.send('run_action_registered', {action_id: Action.id});

            FireRequest(new BrowsersUser_SendActionToBrowser({Action: Action}),
                function(result) {
                    if(result.event instanceof Browsers_ActionDone) {
                        event.client.send('run_action_done', result.event);
                    }
                    if(result.event instanceof Browsers_ActionFail) {
                        event.client.send('run_action_fail', result.event);
                    }
                }
            )
        }
    },
    sendBrowserIdToRunner() {
        var event = CatchEvent(SocketServer_ClientMessage);
        if(event._type == 'request_browser') {
            FireRequest(new BrowsersUser_SearchBrowserRq({
                token: event.data.token,
                params: event.data.params,
                cancelPromise: event.client.disconnectPromise
            }),function(result) {
                event.client.send('request_browser_success', { browser_id: result.Browser.id })
            })
        }
    }
};

Core.processNamespace(classes);


//var io = require('socket.io')(http);

io = (function() {

    var once = {};

    return {
        once: function (_type, cb) {
            once[_type] = cb;
        }
    }
})();

//app.get('/', function(req, res){
//  res.sendfile('index.html');
//});

var token2browsers = {};
var token2runners  = {};

var browsers = {};
var runners_waits_for_browser = [];


(function listen_connections() {

    io.once('connection', function(socket) {

        listen_connections();

        socket.on('register_browser', function(data) {

            var Browser = {socket: socket, id: data.id, token: data.token, params: data.params};

            if(!token2browsers[Browser.token]) {
                token2browsers[Browser.token] = [];
            }

            token2browsers[Browser.token].push(Browser);
            browsers[Browser.id] = Browser;

            socket.emit('register_browser_success', true);

            for(var i = 0; i < runners_waits_for_browser.length; i++) {
                if(Browser = find_browser_for_runner(runners_waits_for_browser[i].data)) {
                    runners_waits_for_browser.socket.emit('request_browser_success', { browser_id: Browser.id });
                }
            }

            socket.on('disconnect', function() {
                token2browsers[Browser.token].splice(token2browsers[Browser.token].indexOf(Browser), 1);
                delete browsers[Browser.id];
            });

        });

        socket.on('request_browser', function(data) {

            var Browser = find_browser_for_runner(data);

            if(Browser) {
                socket.emit('request_browser_success', {browser_id: Browser.id});
            } else {
                runners_waits_for_browser.push({socket: socket, data: data});
            }

        });

    });
})();


