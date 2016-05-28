#! /usr/bin/env node
//var SteamWebapi = require('steam-webapi');
var SteamWebAPI = require('@doctormckay/steam-webapi');
var getSteamAPIKey = require('steam-web-api-key');

var admin_logins_ALL = [
	'jacobtruman',
	'katytruman',
	'granttruman',
	'draketruman',
	'gabbytruman',
	'logantruman',
	'jwillt',
	'jwt',
	'willtru',
	'ivlostskitch'
];

var admin_logins = [
	'jacobtruman'
];

var admins = [];

var steam_webapi;

var api_key = 'D1BAB58EDEBE08D06ABAF7CE57F6268C';

var item_schema = [];
var item_qualities = [];

setupWebAPI(function() {
	/*var defindex = '447';
	var id = '3917821569';
	var steamid = '76561198022319482';
	getTradeItemByDefindex(defindex, steamid, function(items) {
		console.log(items);

		getTradeItemById(id, steamid, function(item) {
			if(item !== false) {
				console.log(item);
			} else {
				console.log("Item id " + id + " not found in inventory for steamid " + steamid);
			}
		});
	});*/

	getSchema(function() {
		console.log(item_qualities[11]);
	});

	/*runTest(function() {
		throw Error("STOP HERE");
	});
	//printWebAPIMethods();
	getSchema(function() {
		getAdmins(function() {
			runCheck();
			//startMonitor();
			//runSeparateMonitor();
		});
	});*/
});

function startMonitor() {
	var minutes = 5, the_interval = minutes * 60 * 1000;
	setInterval(function() {
		console.log("I am doing my 5 minutes check");
		// do your stuff here
		runCheck();
	}, the_interval);
}

function runSeparateMonitor() {
	var seconds = 10, the_interval = seconds * 1000;
	setInterval(function() {
		console.log("I am doing my 10 second check");
	}, the_interval);
}

function runCheck() {
	admins.forEach(function(admin_id) {
		isUserInGame(admin_id, function(in_game) {
			if(in_game || 1) {
				getNewUserItems(admin_id, function(items) {
					console.log(items);
				});
			}
		});
	});
}

function setupWebAPI(callback) {
	console.log("Setting up WebAPI...");
	var steam_webapi = new SteamWebAPI(api_key);
	var input = {};
	steam_webapi.get("IEconItems_440", "GetSchema", 1, function(err, schema) {
		if (err) {
			console.log(err);
		} else {
			console.log(schema);
		}
	});
	/*
	SteamWebapi.gameid = SteamWebapi.TF2;
	SteamWebapi.appid = SteamWebapi.TF2
	getSteamAPIKey(options, function (err, APIKey) {
		if (err) {
			console.log(err);
			SteamWebapi.key = api_key;
		} else {
			SteamWebapi.key = APIKey;
		}

		SteamWebapi.ready(function (err) {
			if (err) {
				throw err;
			}
			steam_webapi = new SteamWebapi();

			console.log("WebAPI setup complete");
			if (typeof(callback) == "function") {
				callback(true);
			}
		});
	});
	*/
}

function getSchema(callback) {
	if(item_schema.length <= 0) {
		console.log("Getting schema...");
		var item_count = 0;
		steam_webapi.getSchema({language:'en'}, function(err, schema) {
			if(err) {
				throw Error(err);
			}
			console.log("Got schema!");
			if(schema.qualities !== undefined) {
				for(quality in schema.qualities){
					item_qualities[schema.qualities[quality]] = schema.qualityNames[quality];
				}
			}
			schema.items.forEach(function(item) {
				item_schema[item.defindex] = item;
				item_count++;

				if(item_count == schema.items.length && typeof(callback) == "function") {
					callback(true);
				}
			});
		});
	} else {
		if(typeof(callback) == "function") {
			callback(true);
		}
	}
}

function getNewUserItems(user_id, callback) {
	steam_webapi.getPlayerItems({steamid:user_id}, function(err, user_items) {
		var new_items = {metal:[], crates:[], items:[]};
		var count = 0;
		user_items.items.forEach(function(item) {
			count++;
			getItemInventoryInfo(item.inventory, function(inventory_info) {
				if(!inventory_info.in_backpack) {
					createTradeItem(item, function(trade_item) {
						switch(item_schema[item.defindex].item_class) {
							case "craft_item":
								new_items.metal.push(trade_item);
								break;
							case "supply_crate":
								new_items.crates.push(trade_item);
								break;
							default:
								new_items.items.push(trade_item);
								break;
						}
					});
				}

				if(typeof(callback) == "function" && count == user_items.items.length) {
					callback(new_items);
				}
			});
		});
	});
}

function getUserItems(user_id, callback) {
	steam_webapi.getPlayerItems({steamid:user_id}, function(err, user_items) {
		var items = [];
		var count = 0;
		user_items.items.forEach(function(item) {
			count++;
			getItemInventoryInfo(item.inventory, function(inventory_info) {
				items.push(inventory_info);

				if(typeof(callback) == "function" && count == user_items.items.length) {
					callback(items);
				}
			});
		});
	});
}

function getAdmins(callback) {
	admin_logins.forEach(function(login) {
		steam_webapi.resolveVanityURL({vanityurl:login}, function(err, user_info) {
			admins.push(user_info.steamid);
			if(admins.length == admin_logins.length) {
				callback(true);
			}
		});
	});
}

function getItemInventoryInfo(inventory_id, callback) {
	var bin = inventory_id.toString(2);
	var bin_split = bin.split("");
	var ret_val = {};
	// ignore bin_split[0] - always 1
	ret_val.in_backpack = (bin_split[1] == 1 ? false : true);
	/*for(var i = 1; i <= 6; i++) {
		ret_val.in_backpack += bin_split[i].toString();
	}*/
	/*ret_val.engineer = bin_split[7];
	ret_val.spy = bin_split[8];
	ret_val.pyro = bin_split[9];
	ret_val.heavy = bin_split[10];
	ret_val.medic = bin_split[11];
	ret_val.demoman = bin_split[12];
	ret_val.soldier = bin_split[13];
	ret_val.sniper = bin_split[14];
	ret_val.scout = bin_split[15];*/
	var location = "";
	for(var i = 16; i <= 31; i++) {
		location += bin_split[i].toString();
	}
	ret_val.location = parseInt(location, 2);
	callback(ret_val);
}

function runTest(user_id, callback) {
	steam_webapi.getPlayerSummaries({steamids:user_id}, function(err, result) {
		console.log(result);

		callback(true);
	});
}

function isUserInGame(user_id, callback) {
	steam_webapi.getPlayerSummaries({steamids:user_id}, function(err, result) {
		var ret_val = false;

		if(result.players[0].gameid && result.players[0].gameid == 440) {
			ret_val = true;
		}

		callback(ret_val);
	});
}

function printWebAPIMethods() {
	for(var m in steam_webapi) {
		if(typeof steam_webapi[m] == "function") {
			console.log(m);
		}
	}
	throw Error("STOP HERE");
}

function createTradeItem(item, callback) {
	var tradeItem = {
		"appid": 440,
		"contextid": 2,
		"amount": 1,
		"assetid": item.id
	};

	if(typeof(callback) == "function") {
		callback(tradeItem);
	}
}

function getTradeItemByDefindex(defindex, steamid, callback) {
	console.log(defindex);
	steam_webapi.getPlayerItems({steamid:steamid}, function(err, user_items) {
		var items = [];
		var count = 0;
		user_items.items.forEach(function(item) {
			count++;
			if(item.defindex == defindex) {
				console.log("Adding item");
				items.push(item);
			}
			if(count >= user_items.items.length && typeof(callback) == "function") {
				callback(items);
			}
		});
	});
}

function getTradeItemById(id, steamid, callback) {
	console.log(id);
	steam_webapi.getPlayerItems({steamid:steamid}, function(err, user_items) {
		var count = 0;
		user_items.items.some(function(item) {
			count++;
			if(item.id == id && typeof(callback) == "function") {
				callback(item);
				return true;
			} else if(count >= user_items.items.length && typeof(callback) == "function") {
				callback(false);
				return false;
			}
		});
		/*user_items.items.forEach(function(item) {
			count++;
			if(item.id == id && typeof(callback) == "function") {
				found = true;
				callback(item);
			} else if(!found && count >= user_items.items.length && typeof(callback) == "function") {
				callback(false);
			}
		});*/
	});
}