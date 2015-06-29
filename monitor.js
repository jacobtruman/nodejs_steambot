// monitor.js
var fs = require('fs');
var cp = require('child_process');
var lock_dir = __dirname + "/.locks";

var file_name = __filename.substr(__dirname.length + 1);
var monitor_lock_file = lock_dir + "/" + file_name + ".lock";

var children = [];

var accounts = [
	{login:"jacobtruman", manager:1},
	{login:"katytruman"},
	{login:"granttruman"},
	{login:"draketruman"},
	{login:"gabrielletruman"},
	{login:"logantruman"},
	{login:"jwilltruman"},
	{login:"jacobwtruman"},
	{login:"williamtruman"},
	{login:"ivlostskitch"}
];

init(monitor_lock_file);

function init(lock_file, callback) {
	fs.exists(lock_file, function(exists) {
		if(exists) {
			console.log("Lock file '" + lock_file + "' exists");
			exit();
		} else {
			fs.writeFile(lock_file, process.pid, function(err) {
				if(err) {
					console.log(err);
				}
			});
			if(typeof(callback) == "function") {
				callback();
			}
		}
	});
}

function cleanup(lock_file, callback) {
	console.log("\nTrying to cleanup lock file: " + lock_file);
	fs.unlink(lock_file, function(err) {
		if(err) {
			console.log(err);
		}
		if(typeof(callback) == "function") {
			callback();
		}
	});
}

function exit() {
	console.log("Exiting");
	process.exit();
}

process.on('exit', function() {
	cleanup(monitor_lock_file, exit);
});

process.on('SIGINT', function() {
	cleanup(monitor_lock_file, exit);
});

process.on('uncaughtException', function() {
	cleanup(monitor_lock_file, exit);
});

for(i in accounts) {
	children[i] = forkChild(i);
}

function sendMessageToChild(child, index, array) {
	child.send({ index: index });
}

function forkChild(i) {
	var account = accounts[i];
	var script;
	var child_lock_file = lock_dir + "/" + account.login + ".lock";

	init(child_lock_file, function() {

		if(account.manager) {
			script = "trade_offers.js";
		} else {
			script = "trade_offers_dev.js";
		}
		var child = cp.fork(__dirname + '/' + script, [account.login]);

		child.on('message', function(m) {
			//console.log('PARENT got message:', m);
			console.log("Got message from child: " + m.index);
		});

		child.on('exit', function() {
			cleanup(child_lock_file);
			console.log("Child " + i + " died");
			children[i] = forkChild(i);
		});

		child.on('SIGINT', function() {
			cleanup(child_lock_file);
		});

		return child;
	});
}

//children.forEach(sendMessageToChild);