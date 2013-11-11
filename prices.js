/*var http = require('http');

var options = {
	host: 'backpack.tf',
	port: 80,
	path: '/api/IGetPrices/v3/?format=json&key=5267ee064dd7b84b318b4567'
}

http.get(options, function(resp){
  //resp.on('data', function(chunk){
    //do something with chunk
	console.log(resp);
  //});
}).on("error", function(e){
  console.log("Got error: " + e.message);
});
*/

var request = require('request');
var mkdirp = require('mkdirp');
var fs = require('fs');
//var util = require('util');

// cli paramters
var args = process.argv.splice(2);

var now = new Date();
var year = now.getFullYear();
var month = now.getMonth();
var day = now.getDay();
var hour = now.getHours();

// variables
var assetsDir = __dirname + "/assets/";
mkdirp(assetsDir, function(err) {
	// path was created unless there was error
});

var pricesFile = assetsDir + "prices_" + year + "-" + month + "-" + day + "-" + hour + ".json";

var priceList = {};

// config
var configFile = __dirname + "/configs/" + args[0] + ".json";

// bot config object
var config = [];

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

var fetchPrices = function(callback) {
	if(!fs.existsSync(pricesFile)) {
		console.log("Prices file does not exist: " + pricesFile);
		j = request.jar();
		request = request.defaults({jar:j});

		request.get({
			uri: "http://backpack.tf/api/IGetPrices/v3/?names=1&format=json&key=" + config.backpacktf_key,
			json: true
		}, function(error, response, data) {
			if (error) {
				console.log(error);
				return;
			}

			if(data.response1) {
				fs.writeFile(pricesFile, JSON.stringify(data.response), function (err) {
					if (err) throw err;
					callback();
				});
			} else {
				console.log("data.response does not exist - not writing file");
				getNewestFile(getPricesFromFile(callback));
			}
		});
	} else {
		console.log("Prices file exists: " + pricesFile);
		getPricesFromFile(callback);
	}
}

var getItemPrice = function(item_id, callback) {
	console.log("Getting item price");
	fetchPrices(function() {
		if(priceList.prices[item_id]) {
			var item = priceList.prices[item_id];
			var name = item.item_info.item_name;
			var currency = item[6][0].current.currency;
			var price = item[6][0].current.value;

			console.log(name);
			console.log(price+" "+currency);
		} else {
			console.log("Item ID "+item_id+" does not exist");
		}
	});
}

var getPricesFromFile = function(callback) {
	if(fs.existsSync(pricesFile)) {
		console.log("Getting prices from file: " + pricesFile);
		var data = fs.readFileSync(pricesFile, 'utf8');
		if(data != undefined) {
			priceList = JSON.parse(data);
			callback();
		}
	} else {
		console.log("Prices file does not exist: " + pricesFile);
	}
}

var getNewestFile = function(callback) {
	console.log("Getting newest file");
	var files = fs.readdirSync(assetsDir);
	var stats;
	var filetime;
	var ts;
	var newest = 0;
	var newest_file;
	for(var i in files) {
		//console.log(assetsDir + files[i]);
		stats = fs.statSync(assetsDir + files[i]);
		filetime = new Date(stats.mtime);
		ts = filetime.getTime();
		if (ts > newest) {
			newest = ts;
			pricesFile = assetsDir + files[i];
		}
	}
	if(i >= files.length - 1) {
		console.log("Callback");
		callback();
	}
}

getItemPrice('5021');
