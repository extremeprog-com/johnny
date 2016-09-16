require('../../tests_globals.js').init();

var token = random_token();
var Runner  = create_runner();

it('should request browser', function(done) {
    Runner.socket.send('request_browser', {token: token, params: {type: 'Chrome', version: 25}});
    done();
});

var Browser = create_browser();

it('should register browser', function(done) {
    Browser.socket.send('register_browser', {token: token, id: Browser.id, params: {type: "Chrome", version: 25 }});
    done()
});

it('should send confirmation to browser', function(done) {
    Browser.socket.once('register_browser_success', function() {
        done();
    });
});


it('should send browser_id to runner', function(done) {
    Runner.socket.once('request_browser_success', function(data) {
        assert(data);
        assert(data.browser_id == Browser.id);

        done();
    });
});

