#! /usr/bin/env node

process.on('message', function (m) {
	console.log(m);
});

/**
 Variables
 */

// requires
var fs = require('fs');
var logger = require('tru-logger');
var steam = require('steam');
var SteamWebAPI = require('@doctormckay/steam-webapi');
var mkdirp = require('mkdirp');
//var nodemailer = require("nodemailer");
//var mysql = require('mysql');
var TeamFortress2 = require('tf2');
var prompt = require('prompt');
var SteamTotp = require('steam-totp');

prompt.start();

var admin_accounts = [];

var crates_to_keep = [30, 40, 50, 60, 93, 94, 95, 96, 97];
var crate_series_cap = 97;

/*var connection = mysql.createConnection({
 host     : 'localhost',
 user     : '',
 password : '',
 database : ''
 });

 connection.connect();

 connection.query('SELECT * from tf2_items', function(err, rows, fields) {
 if (err) throw err;

 console.log('The solution is: ', rows[0].name);
 rows.forEach(function(row) {
 console.log(row.name);
 });
 });

 connection.end();*/

// cli parameters
var args = process.argv.splice(2);

// configs
var configFile = __dirname + "/configs/config.json";
var accountConfigFile = __dirname + "/configs/" + args[0] + ".json";

// bot config objects
var config = [];
var account_config = [];

// variables
var logDir = __dirname + "/logs/";
mkdirp(logDir, function (err) {
	// path was created unless there was error
});

// authentication vars
var sentryFile = null;

// steam bot vars
var steamClient = new steam.SteamClient();
var steamUser = new steam.SteamUser(steamClient);
var tf2 = new TeamFortress2(steamUser);
var item_schema = [];
var steam_webapi;

var my_steamid = null;

/**
 Logic
 */

// main config file
if (fs.existsSync(configFile)) {
	var data = fs.readFileSync(configFile, 'utf8');
	if (data != undefined) {
		config = JSON.parse(data);
	} else {
		throw Error("MISTAKE: there was a problem reading the config file: " + configFile);
	}
} else {
	throw Error("MISTAKE: configFile does not exist: " + configFile);
}

// account config file
if (fs.existsSync(accountConfigFile)) {
	var data = fs.readFileSync(accountConfigFile, 'utf8');
	if (data != undefined) {
		account_config = JSON.parse(data);
	} else {
		throw Error("MISTAKE: there was a problem reading the config file: " + accountConfigFile);
	}
} else {
	throw Error("MISTAKE: configFile does not exist: " + accountConfigFile);
}

// make sure there is a username defined
if (account_config.username == undefined) {
	throw new Error("Please specify username");
}

// initialize log
var logOptions = {
	file: logDir + account_config.username + ".txt",
	date: true,
	print: true,
	//log_level: ["success", "error"],
	log_level: ["success", "error"],
	prefix: account_config.username
};

var myLog = new logger(logOptions);

if (config.admin_accounts) {
	admin_accounts = config.admin_accounts;
}

function botLogon() {
	myLog.success('Attempting to logon bot for ' + account_config.username);
	// try to login with sentry file
	sentryFile = __dirname + '/sentries/sentryfile.' + account_config.username;
	if (fs.existsSync(sentryFile)) {
		myLog.success('Sentry file for ' + account_config.username + ' found.');
		steamUser.logOn({
			account_name: account_config.username,
			password: account_config.password,
			sha_sentryfile: fs.readFileSync(sentryFile)
		});
	} else { // else ask for or generate a steamGuard auth code*/
		myLog.warning('Sentry file for ' + account_config.username + ' does not exist.');
		if(account_config.steam_guard.shared_secret != undefined) {
			steamUser.logOn({
				account_name: account_config.username,
				password: account_config.password,
				two_factor_code: SteamTotp.generateAuthCode(account_config.steam_guard.shared_secret)
			});
		} else {
			var schema = {
				properties: {
					code: {
						message: 'Steam Guard Code: ',
						required: true
					}
				}
			};
			prompt.get(schema, function (err, result) {
				steamUser.logOn({
					account_name: account_config.username,
					password: account_config.password,
					two_factor_code: result.code
				});
			});
		}
	}
}

steamClient.connect();
steamClient.on('connected', function () {
	myLog.success("Steam Client connected");
	botLogon();
});

/**
 Bot listeners and calls
 */

// bot debug stuff
steamClient.on('debug', function (data) {
	myLog.info("BOT DEBUG: " + data);
});

steamClient.on('loggedOff', function () {
	// try to log back on
	botLogon();
});

// create sentry file
steamClient.on('sentry', function (sentryHash) {
	myLog.info("Creating sentry file");
	fs.writeFile(sentryFile, sentryHash, function (err) {
		if (err) {
			myLog.error(err);
		} else {
			myLog.success('Saved sentry file hash as "' + sentryFile + '"');
		}
	});
});

// logged in, set state to "online"
steamClient.on('logOnResponse', function (logonResp) {
	if (logonResp.eresult === steam.EResult.OK) {
		myLog.success(account_config.username + " logged on!");
		var options = {};
		options.APIKey = config.web_api_key;
		setupWebAPI(options, function () {
			getSchema(function () {
				getMySteamId(function (steamId) {
					myLog.info("Got my steam id: " + steamId);
					console.log("Launching TF2");
					steamUser.gamesPlayed({"games_played": [{"game_id": 440}]});
				});
			});
		});
	}
});

tf2.on("backpackLoaded", function() {
	console.log("Backpack loaded");
	//console.log(tf2.backpack);
	getSchema(function () {
		loadMenu();
	});
});

function craftByGroup(grouped_items, num, callback) {
	var craft_group = [];
	for(var item_group in grouped_items) {
		var items = grouped_items[item_group];
		console.log(item_group+": "+items.length);
		if(item_group !== "refined") {
			if(items.length >= num) {
				for(var item_index in items) {
					var item = items[item_index];
					if (craft_group.length < num) {
						craft_group.push(item.id);
						if (craft_group.length == num) {
							tf2.craft(craft_group);
							// empty array
							craft_group = [];
							craft_group.length = 0;
						}
					}
				}
			}
		}
		craft_group = [];
		craft_group.length = 0;
	}

	if (typeof(callback) == "function") {
		callback(true);
	}
}

tf2.on("craftingComplete", function(recipe, itemsGained) {
	//console.log(recipe);
	console.log(itemsGained);
});

tf2.on("itemAcquired", function(item) {
	console.log("ITEM ACQUIRED");
	//console.log(item);
	getItemInfo(item, function(item_info) {
		if(item_info.name !== undefined) {
			console.log(item_info.name);
		} else {
			console.log(item_info);
		}
	});
});

tf2.on("itemRemoved", function(item) {
	console.log("ITEM REMOVED");
	//console.log(item);
	getItemInfo(item, function(item_info) {
		if(item_info.name !== undefined) {
			console.log(item_info.name);
		} else {
			console.log(item_info);
		}
	});
});

function groupItems(user_items, callback) {
	var defindex;
	var itemInfo;
	var item;
	var valid_item_slots = ["melee", "primary", "secondary", "pda2", "building"];
	var grouped_items = {scout:[], soldier:[], pyro:[], demoman:[], heavy:[], engineer:[], medic:[], sniper:[], spy:[]};
	for(var item_index in user_items) {
		item = user_items[item_index];
		defindex = item.defindex;
		// only "unique" items
		if(item.quality === 6 && !isDefindexExcluded(defindex)) {
			// check if it is craftable
			if (item.flag_cannot_craft === undefined || !item.flag_cannot_craft) {
				itemInfo = item_schema[defindex];
				// exclude all-class items
				if (itemInfo.used_by_classes !== undefined && itemInfo.used_by_classes.length > 0 && valid_item_slots.indexOf(itemInfo.item_slot) > -1) {
					for(var item_class_index in itemInfo.used_by_classes) {
						var item_class = itemInfo.used_by_classes[item_class_index].toLowerCase();
						grouped_items[item_class].push(item);
					}
				}
			}
		}
	}

	if (typeof(callback) == "function") {
		callback(grouped_items);
	}
}

function groupMetal(user_items, callback) {
	var defindex;
	var item;
	var metalIndexes = {scrap: 5000, reclaimed: 5001, refined: 5002};
	var metal = {scrap:[], reclaimed:[], refined:[]};
	for(var item_index in user_items) {
		item = user_items[item_index];
		defindex = item.defindex;
		// only "unique" items
		if(item.quality === 6) {
			// check if it is craftable
			if (item.flag_cannot_craft === undefined || !item.flag_cannot_craft) {
				// scrap
				if(defindex == metalIndexes.scrap) {
					metal.scrap.push(item);
				}

				// reclaimed
				if(defindex == metalIndexes.reclaimed) {
					metal.reclaimed.push(item);
				}

				// refined
				if(defindex == metalIndexes.refined) {
					metal.refined.push(item);
				}
			}
		}
	}

	if (typeof(callback) == "function") {
		callback(metal);
	}
}

function deleteCrates(user_items, callback) {
	var schema = {
		properties: {
			confirm: {
				message: 'Would you like to delete crates? (yes/no)',
				default: "no",
				required: true
			}
		}
	};
	prompt.get(schema, function(err, result) {
		if(result.confirm == "yes") {
			console.log("DELETING CRATES");
			for (var item_index in user_items) {
				var item = user_items[item_index];
				var defindex = item.defindex;
				var itemInfo = item_schema[defindex];

				if (itemInfo.item_class == "supply_crate") {
					console.log(itemInfo.name);
					for (var attribute_index in itemInfo.attributes) {
						if (itemInfo.attributes[attribute_index]['class'] == "supply_crate_series") {
							var series = itemInfo.attributes[attribute_index]['value'];
							if (crates_to_keep.indexOf(series) == -1 && series <= crate_series_cap) {
								tf2.deleteItem(item.id);
							}
						}
					}
				}
			}

			if (typeof(callback) == "function") {
				callback(true);
			}
		} else {
			if (typeof(callback) == "function") {
				callback("NOT deleting");
			}
		}
	});
}

function sortBackpack(callback) {
	var schema = {
		properties: {
			sort: {
				message: 'What would you like to sort by?',
				required: true
			}
		}
	};

	prompt.get(schema, function(err, result) {
		var sortTypes = {0:"?", 1:"?", 2:"?", 3:"Quality", 4:"Type", 5:"Date"};
		var sortType = parseInt(result.sort);
		var sortName = "unknown";

		tf2.sortBackpack(sortType);
		if (typeof(callback) == "function") {
			if(sortTypes[sortType] != undefined) {
				sortName = sortTypes[sortType];
			}
			callback("Backpack has been sorted by "+sortName);
		}
	});
}

function userItemInfo(user_items, callback) {
	for (var item_index in user_items) {
		var item = user_items[item_index];
		var defindex = item.defindex;
		var itemInfo = item_schema[defindex];
		console.log(item);
		console.log(itemInfo);
	}

	if (typeof(callback) == "function") {
		callback(true);
	}
}

function isDefindexExcluded(defindex) {
	var excluded = [264, 572, 727, 452, 466, 638, 574, 298, 294, 297];
	if(excluded.indexOf(defindex) > -1) {
		console.log("Excluding "+defindex);
		return true;
	}
	return false;
}

/**
 * Helper functions
 */

function getSchema(callback) {
	if (item_schema.length <= 0) {
		myLog.info("Getting schema...");
		var item_count = 0;

		steam_webapi.get("IEconItems_440", "GetSchema", 1, function(err, schema) {
			if (err) {
				// wait 5 seconds between tries
				setTimeout(function () {
					getSchema(callback)
				}, 5000);
			} else {
				if(schema.result !== undefined && schema.result.items !== undefined) {
					schema.result.items.forEach(function (item) {
						item_schema[item.defindex] = item;
						item_count++;

						if (item_count == schema.result.items.length && typeof(callback) == "function") {
							callback(true);
						}
					});
				} else {
					// wait 5 seconds between tries
					setTimeout(function () {
						getSchema(callback)
					}, 5000);
				}
			}
		});
	} else {
		if (typeof(callback) == "function") {
			callback(true);
		}
	}
}

function getItemInfo(item, callback) {
	var item_info = {};
	if(item_schema[item.defIndex] !== undefined) {
		item_info = item_schema[item.defIndex];
	} else {
		myLog.error("defindex "+item.defIndex+" not found in schema");
	}

	if (typeof(callback) == "function") {
		callback(item_info);
	}
}

function setupWebAPI(options, callback) {
	myLog.info("Setting up WebAPI...");
	steam_webapi = new SteamWebAPI(options.APIKey);
	myLog.success("WebAPI setup complete");
	if (typeof(callback) == "function") {
		callback(true);
	}
}

function getMySteamId(callback) {
	if (my_steamid === null) {
		if (account_config.steamid !== undefined) {
			my_steamid = account_config.steamid;
			myLog.warning("Setting my steam id from account_config: " + my_steamid);
		} else {
			if (admin_accounts[account_config.username] != undefined) {
				my_steamid = admin_accounts[account_config.username].id;
				myLog.warning("Setting my steam id from admin_accounts: " + my_steamid);
			} else {
				myLog.error(account_config.username + " is not a valid admin account");
			}
		}
	}

	if (typeof(callback) == "function" && my_steamid !== null) {
		callback(my_steamid);
	}
}

function loadMenu() {
	var menu = "Possible actions:\n";
	menu += "scrap\n".yellow;
	menu += "smelt\n".green;
	menu += "delete\n".red;
	menu += "sort\n".blue;
	menu += "info\n".cyan;
	menu += "exit\n".magenta;
	console.log(menu);

	var schema = {
		properties: {
			action: {
				message: 'What would you like to do?',
				required: true
			}
		}
	};
	prompt.get(schema, function(err, result) {
		var options  = {SteamID: my_steamid};
		if(result.action == "exit") {
			process.exit();
		} else if(result.action == "scrap") {
			steam_webapi.get("IEconItems_440", "GetPlayerItems", 1, options, function(err, response) {
				if (response.result !== undefined && response.result.items !== undefined) {
					var items = response.result.items;
					groupItems(items, function(items) {
						console.log("Scrapping");
						craftByGroup(items, 2, function() {
							loadMenu();
						});
					});
				}
			});
		} else if(result.action == "smelt") {
			steam_webapi.get("IEconItems_440", "GetPlayerItems", 1, options, function(err, response) {
				if (response.result !== undefined && response.result.items !== undefined) {
					var items = response.result.items;
					groupMetal(items, function(metal) {
						console.log("Smelting");
						craftByGroup(metal, 3, function() {
							loadMenu();
						});
					});
				}
			});
		} else if(result.action == "delete") {
			steam_webapi.get("IEconItems_440", "GetPlayerItems", 1, options, function(err, response) {
				if (response.result !== undefined && response.result.items !== undefined) {
					var items = response.result.items;
					console.log("Deleting");
					deleteCrates(items, function(msg) {
						if(msg.length > 0) {
							console.log(msg);
						}
						loadMenu();
					});
				}
			});
		} else if(result.action == "info") {
			steam_webapi.get("IEconItems_440", "GetPlayerItems", 1, options, function(err, response) {
				if (response.result !== undefined && response.result.items !== undefined) {
					var items = response.result.items;
					userItemInfo(items);
				}
			});
		} else if(result.action == "sort") {
			console.log("Sorting");
			sortBackpack(function(msg) {
				if(msg.length > 0) {
					console.log(msg);
				}
				loadMenu();
			});
		} else {
			var msg = "#### \""+result.action+"\" is not a valid action ####";
			console.log(msg.red);
			loadMenu();
		}
	});
}
