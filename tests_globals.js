assert = require('assert');
request = require('request');
SockJS = require('sockjs-client');


function sockjs_wrapper(socket) {

    var once = {};
    var queue = [];

    socket.onmessage = function(message) {
        var msg = JSON.parse(message.data);
        if(once[msg._type]) {
            var cb = once[msg._type];
            delete once[msg._type];
            cb(msg.body);
        } else {
            queue.push(msg);
        }
    };

    return {
        once: function(_type, callback) {
            if(queue.length) {
                var msg = queue.shift();
                if(msg._type) {
                    callback(msg.body)
                } else {
                    console.error('Unexpected message: ' + JSON.stringify(message));
                }
            } else {
                once[_type] = callback;
            }
        },
        send: function(_type, data) {
            socket.send(JSON.stringify({_type: _type, body: data}))
        },
        socket: socket
    }
}


create_browser = function() {
    var Browser = {
        id: random_token()
    };

    uit('[create browser connection]', function(done) {
        var sock = new SockJS('http://localhost:' + server_port + '/echo');

        Browser.socket = sockjs_wrapper(sock);
        sock.onopen = function() {
            done();
        };
    });
    return Browser;
};

create_runner = function() {
    var Runner = {};

    uit('[create runner connection]', function(done) {
        var sock = new SockJS('http://localhost:' + server_port + '/echo');

        Runner.socket = sockjs_wrapper(sock);
        sock.onopen = function() {
            done();
        };
    });
    return Runner;
};

random_email = function() {
    return Math.random().toString().substr(2) + '@test.tld';
};

random_password = function() {
    return Math.random().toString(36).substr(2);
};

random_token = function() {
    return Math.random().toString(36).substr(2);
};

random_date = function() {
    var date = new Date(new Date().getTime() - (365 * 24 * 3600 * 1000) + parseInt(Math.random() * (365 * 24 * 3600 * 1000)));
    return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
};

random_time = function() {
    return parseInt(Math.random() * 24) * 100 + parseInt(Math.random() * 60);
};

random_title = function() {
    return Math.random().toString(32).substr(2);
};

merge_data = function(destination, source, fields) {
    if(!fields) {
        fields = Object.keys(source);
    }
    fields.map(function(field) {
        destination[field] = source[field]
    });
    if(arguments[3]) {
        var next_args = [].concat(arguments);
        next_args.splice(1,2);
        merge_data.apply(null, next_args);
    }
    return destination;
};


server_process = null;
server_port = 64000 + parseInt(Math.random() * 1535);
mongo_url = 'mongodb://localhost:27017/mongo-sites';

user  = {};
admin = {};

admin.email     = random_email();
admin.password  = random_password();

user.email      = random_email();
user.password   = random_password();

create_user_for_test = function(email, password, cb) {

    if(arguments[0] instanceof Function) { return create_user_for_test(random_email(), random_password(), arguments[0]); }
    if(arguments[1] instanceof Function) { return create_user_for_test(email         , random_password(), arguments[1]); }

    var user = {};
    jar = request.jar();

    api_post('/api/auth/register', [{ _id: email, password: password }], function(err, res) {
        api_post(res.body[1].activation_link, function(err, res) {
            api_post('/api/auth', [email, password], function(err, res) {

                //user.token = res.body && res.body.result && res.body.result.auth_token;
                user.jar = jar;

                cb(user);
            });
        });
    });

    //setTimeout(function() {
    //    user.token = Math.random().toString(32).substr(2);
    //    user.User  = {};
    //    cb(user);
    //}, 200);

    return user;
};

var headers = {
    'Referer': "http://localhost:" + server_port,
    'X-MongoApi-Site': 'test'
};

jar = false;

initCookie = function(User) {

    uit && uit('[init empty cookie]', i);

    function i() {
        if(User === false) {
            jar = false;
        } else if(User === true || User === undefined) {
            jar = request.jar();
        } else {
            jar = User.jar;
        }
    }
};

api_get = function(url, cb) {
    if(!url.match(/^https?:\/\//)) url = "http://localhost:" + server_port + url;
    request.get({url: url, json: true, headers: headers, jar : jar || request.jar() }, function(err, res, body) {
        log_resource(body, "request GET " + url + '. response ' + res.statusCode);
        cb(err, res, body);
    })
};

api_post = function(url, data, cb) {
    if(!url.match(/^https?:\/\//)) url = "http://localhost:" + server_port + url;
    if(data instanceof Function) {
        cb = data;
        data = null;
    }
    request.post({url: url, json: true, headers: headers, jar : jar || request.jar(), body: data }, function(err, res, body) {
        log_resource(body, "request POST " + url + ' data ' + JSON.stringify(data) + ' response ' + res.statusCode);
        cb(err, res, body);
    })
};

api_delete = function(url, data, cb) {
    if(!url.match(/^https?:\/\//)) url = "http://localhost:" + server_port + url;
    if(data instanceof Function) {
        cb = data;
        data = null;
    }
    request.delete({url: url, json: true, headers: headers, jar : jar || request.jar(), body: data }, function(err, res, body) {
        log_resource(body, "request DELETE " + url + ' data ' + JSON.stringify(data) + ' response ' + res.statusCode);
        cb(err, res, body);
    })
};

before(function(done) {
    //log_resource('trying to start', 'server');
    server_process = require('child_process').spawn(
        'node', ['johnny.server.js'], { env: { TEST_ENV: 'DEV_TEST', PATH: process.env.PATH, PORT: server_port, ADMIN_USER: admin.email, MONGO_URL: mongo_url } }
    );
    server_process.stdout.on('data', function(chunk) {
        log_resource(chunk.toString(), "server's stdout");
    });
    server_process.stderr.on('data', function(chunk) {
        log_resource(chunk.toString(), "server's stderr");
    });
    (function waitServer() {
        request("http://localhost:" + server_port + "/", function(err) {
            if (err) {
                setTimeout(function() {
                    waitServer()
                }, 10);
            } else {
                //create_user_for_test(admin.email, admin.password, function(created_user) {
                //    //admin.token = created_user.token;
                //    admin.jar   = created_user.jar;
                //
                //    create_user_for_test(user.email, user.password, function(created_user) {
                //        //user.token = created_user.token;
                //        user.jar   = created_user.jar;
                //
                //        done();
                //    });
                //});
                setTimeout(done, 1000);
                //done();
            }
        })
    })();
});

after(function() {
    //log_resource('stopping', 'server');
    server_process.kill()
});

var fs = require('fs');
var logged_resources = [];

fs.existsSync('tests_debug.log') && fs.unlinkSync('tests_debug.log');

log_resource = function(value, name) {
    name = name || ('resource.log() ' + test_filestring() + ': ');
    logged_resources.unshift("[" + new Date().toString() + "] " + (name ? name + ' ': "") + JSON.stringify(value));
    fs.writeFileSync('tests_debug.log', logged_resources.join("\n"));
};

resource = {
    log: log_resource
};


var test_descriptions = (function iterate_descriptions(base, result, text) {
    if(base instanceof Array) {
        for(var i = 0; i < base.length; i++) {
            var matches = base[i].match(/^(unit|func|e2e)\s+([^:\s]+)\s*:\s*(.+)$/);
            var type = matches[1];
            var filename =  matches[2] + '.' + type + '-test.js';
            var description = matches[3];
            result[filename] = text + ' -> Scenario: ' + description;
        }
    } else {
        Object.keys(base).map(function(key) {
            iterate_descriptions(base[key], result, (text ? text + ' -> ' : '' ) + key)
        })
    }
    return result;
})(JSON.parse(fs.readFileSync('tests.json')), {});

test_filestring = function(descr) {
    var matches = new Error().stack.match(/tests\/(.+?\-test.js):\d+/);
    return matches[0] + (descr !== false ?  ' (' + test_descriptions[matches[1]] + ')' : '')
};

module.exports = {
    init: function() {
        if(typeof newit == 'undefined' || newit != it) {
            jar = false;
            uit = it;

            it = newit = function(msg, cb) {
                msg = (msg ? msg + ', ' : '') + test_filestring();
                uit(msg, function(done) {
                    log_resource(msg, "test");
                    cb(done);
                });
            };
        }
    }
};

