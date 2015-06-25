var cp = require('child_process');

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

for(i in accounts) {
	children[i] = forkChild(i);
}

function sendMessageToChild(child, index, array) {
	child.send({ index: index });
}

function forkChild(i) {
	var account = accounts[i];
	var script;
	if(account.manager) {
		script = "trade_offers.js";
	} else {
		script = "trade_offers_dev.js";
	}
	var child = cp.fork(__dirname + '/'+script, [account.login]);
	
	child.on('message', function(m) {
	  //console.log('PARENT got message:', m);
		console.log("Got message from child: " + m.index);
	});
	
	child.on('exit', function() {
		console.log("Child " + i + " died");
		children[i] = forkChild(i);
	});
	return child;
}

//children.forEach(sendMessageToChild);