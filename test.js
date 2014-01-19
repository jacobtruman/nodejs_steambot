/**
Variables
*/

// requires
var fs = require('fs');
var logger = require('tru-logger');
var steam = require('steam');
var SteamTrade = require('steam-trade');
var mkdirp = require('mkdirp');
var nodemailer = require("nodemailer");
var mysql = require('mysql');
var tfprices = require('tfprices');

// cli paramters
var args = process.argv.splice(2);

// config
var configFile = __dirname + "/configs/" + args[0] + ".json";

// bot config object
var config = [];

// variables
var logDir = __dirname + "/logs/";
mkdirp(logDir, function(err) {
	// path was created unless there was error
});
var myLog = new logger(logDir + config.username + ".txt");

if(fs.existsSync(configFile)) {
	var data = fs.readFileSync(configFile, 'utf8');
	if(data != undefined) {
		config = JSON.parse(data);
	} else {
		throw Error("MISTAKE: there was a problem reading the config file: " + configFile);
	}
} else {
	throw Error("MISTAKE: configFile does not exist: " + configFile);
}

// make sure there is a username defined
if(config.username == undefined) {
	throw new Error("Please specify username");
}

var prices = new tfprices(config.backpacktf_key);

prices.getItemPrice('5021', function() {
	console.log("PRICE: " + prices.price);
	console.log("CURRENCY: " + prices.currency);
	console.log("NAME: " + prices.name);
});
