require('colors');

function logger(logFile){
	this.logFile = logFile;
}

var p = logger.prototype;
var fs = require('fs');

p.error = function(msg){
	msg = "ERROR: "+msg.toString();
	console.log((msg).red);
	this.append(msg);
}

p.info = function(msg){
	msg = "INFO: "+msg.toString();
	console.log((msg).cyan);
	this.append(msg);
}

p.warning = function(msg){
	msg = "WARNING: "+msg.toString();
	console.log((msg).yellow);
	this.append(msg);
}

p.success = function(msg){
	msg = "SUCCESS: "+msg.toString();
	console.log((msg).green);
	this.append(msg);
}

p.chat = function(msg){
	msg = "CHAT: "+msg.toString();
	console.log((msg).magenta);
	this.append(msg);
}

p.add = function(msg){
	msg = msg.toString();
	console.log((msg).grey);
	this.append(msg);
}

p.append = function(msg){
	fs.appendFile(this.logFile, msg+"\n", function (err) {
		if (err) throw err;
		//console.log('The "'+msg+'" was appended to file!');
	});
}

module.exports = logger;