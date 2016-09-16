//catch action, transfer to browser, return action id to runner, catch action fail, return result to runner

require('../../tests_globals.js').init();

var Browser = create_browser();
var token = random_token();
var Runner  = create_runner();

it('should register browser', function(done) {
    Browser.socket.send('register_browser', {token: token, id: Browser.id, params: {type: "Chrome", version: 25 }});
    done()
});

it('should send confirmation to browser', function(done) {
    Browser.socket.once('register_browser_success', function() {
        done();
    });
});

it('should request browser', function(done) {
    Runner.socket.send('request_browser', {token: token, params: {type: 'Chrome', version: 25}});
    done();
});

it('should send browser id to runner', function(done) {
    Runner.socket.once('request_browser_success', function(data) {
        assert(data);
        assert(data.browser_id);

        done();
    });
});

//

it('should catch action from runner', function(done) {
    Runner.socket.send('run_action', {browser_id: Browser.id, fn: 'function(a) { console.log(a) }', args: [3]});
    done();
});

var action_id;

it('should return action id to runner', function(done) {
    Runner.socket.once('run_action_registered', function(data) {
        assert(data);
        assert(data.action_id);

        action_id = data.action_id;

        done();
    });
});

it('should send action to browser', function(done) {
    Browser.socket.once('run_action', function(data) {
        assert(data);
        assert(data.action_id);
        assert(data.fn);
        assert(data.args);

        action_id = data.action_id;

        done();
    });
});

it('should catch action done', function(done) {
    Browser.socket.send('run_action_fail', {
        action_id: action_id,
        exception_descriptor: "Wrong parameter alala",
        line: 5
    });
    done();
});

it('should return action result to runner', function(done) {
    Runner.socket.once('run_action_fail', function(data) {
        assert(data);
        assert(data.action_id == action_id);
        assert(data.exception_descriptor == "Wrong parameter alala");
        assert(data.line == 5);

        done();
    });
});