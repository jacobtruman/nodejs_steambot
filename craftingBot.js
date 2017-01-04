#! /usr/bin/env node

process.on('message', function(m) {
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
mkdirp(logDir, function(err) {
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

var valid_item_slots = ["melee", "primary", "secondary", "pda2", "building"];
var metalIndexes = {scrap: 5000, reclaimed: 5001, refined: 5002};
var menu_wait = 2000; // 2 seconds

var my_steamid = null;

/**
 Logic
 */

// main config file
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
var crates_to_keep = config.crates_to_keep || null;
var crate_series_cap = config.crate_series_cap || null;

// account config file
if(fs.existsSync(accountConfigFile)) {
	var data = fs.readFileSync(accountConfigFile, 'utf8');
	if(data != undefined) {
		account_config = JSON.parse(data);
	} else {
		throw Error("MISTAKE: there was a problem reading the config file: " + accountConfigFile);
	}
} else {
	throw Error("MISTAKE: configFile does not exist: " + accountConfigFile);
}

// make sure there is a username defined
if(account_config.username == undefined) {
	throw new Error("Please specify username");
}

// initialize log
var logOptions = {
	file: logDir + account_config.username + "_craft.txt",
	date: true,
	print: true,
	//log_level: ["success", "error"],
	log_level: ["all"],
	prefix: account_config.username
};

var myLog = new logger(logOptions);

if(config.admin_accounts) {
	admin_accounts = config.admin_accounts;
}

function botLogon() {
	myLog.success('Attempting to logon bot for ' + account_config.username);
	// try to login with sentry file
	sentryFile = __dirname + '/sentries/sentryfile.' + account_config.username;
	if(fs.existsSync(sentryFile)) {
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
			prompt.get(schema, function(err, result) {
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
steamClient.on('connected', function() {
	myLog.success("Steam Client connected");
	botLogon();
});

/**
 Bot listeners and calls
 */

// bot debug stuff
steamClient.on('debug', function(data) {
	myLog.info("BOT DEBUG: " + data);
});

steamClient.on('loggedOff', function() {
	// try to log back on
	botLogon();
});

// create sentry file
steamClient.on('sentry', function(sentryHash) {
	myLog.info("Creating sentry file");
	fs.writeFile(sentryFile, sentryHash, function(err) {
		if(err) {
			myLog.error(err);
		} else {
			myLog.success('Saved sentry file hash as "' + sentryFile + '"');
		}
	});
});

// logged in, set state to "online"
steamClient.on('logOnResponse', function(logonResp) {
	if(logonResp.eresult === steam.EResult.OK) {
		myLog.success(account_config.username + " logged on!");
		var options = {};
		options.APIKey = config.web_api_key;
		setupWebAPI(options, function() {
			getSchema(function() {
				getMySteamId(function(steamId) {
					myLog.info("Got my steam id: " + steamId);
					myLog.chat("Launching TF2");
					steamUser.gamesPlayed({"games_played": [{"game_id": 440}]});
				});
			});
		});
	}
});

tf2.on("backpackLoaded", function() {
	myLog.info("Backpack loaded");
	getSchema(function() {
		loadMenu();
	});
});

function craftByGroup(grouped_items, num, callback) {
	var grouped_items_keys = Object.keys(grouped_items);
	if(grouped_items_keys.length > 0) {
		var item_group = grouped_items_keys.pop();
		var items = grouped_items[item_group];
		delete grouped_items[item_group];
		myLog.attention(item_group + ": " + items.length);
		if(item_group !== "refined") {
			craftGroupItems(items, num, function() {
				craftByGroup(grouped_items, num, callback);
			});
		} else {
			craftByGroup(grouped_items, num, callback);
		}
	} else {
		if(typeof(callback) == "function") {
			callback(true);
		}
	}
}

function craftGroupItems(items, num, callback) {
	// wait 1 second between tries
	setTimeout(function() {
		if(items.length >= num) {
			console.log(items.length + " >= " + num);
			var craft_group = [];
			while(craft_group.length < num) {
				craft_group.push(items.pop().id);
				if(craft_group.length == num) {
					tf2.craft(craft_group);
				}
			}
			craftGroupItems(items, num, callback);
		} else {
			console.log(items.length + " <= " + num);
			if(typeof(callback) == "function") {
				callback(true);
			}
		}
	}, 1000);
}

tf2.on("craftingComplete", function(recipe, itemsGained) {
	myLog.attention("[on] craftingComplete recipe: " + JSON.stringify(recipe) + " items: " + JSON.stringify(itemsGained));
});

tf2.on("itemAcquired", function(item) {
	myLog.success("[+] ITEM ACQUIRED");
	getItemInfo(item, function(item_info) {
		if(item_info.name !== undefined) {
			myLog.success("[+]" + item_info.name);
		} else {
			myLog.attention(JSON.stringify(item_info));
		}
	});
});

tf2.on("itemRemoved", function(item) {
	myLog.warning("[-] ITEM REMOVED");
	getItemInfo(item, function(item_info) {
		if(item_info.name !== undefined) {
			myLog.warning("[-] " + item_info.name);
		} else {
			myLog.attention(JSON.stringify(item_info));
		}
	});
});

function groupItems(options, callback) {
	if(options.items !== null && options.items.length > 0) {
		if(options.grouped_items === null) {
			options.grouped_items = {
				scout: [],
				soldier: [],
				pyro: [],
				demoman: [],
				heavy: [],
				engineer: [],
				medic: [],
				sniper: [],
				spy: []
			}
		}
		var item = options.items.pop();
		var defindex = item.defindex;

		if(item.quality === 6 && !isDefindexExcluded(defindex)) {
			// check if it is craftable
			if(item.flag_cannot_craft === undefined || !item.flag_cannot_craft) {
				var itemInfo = item_schema[defindex];
				// exclude all-class items
				if(itemInfo.used_by_classes !== undefined && itemInfo.used_by_classes.length > 0 && valid_item_slots.indexOf(itemInfo.item_slot) > -1) {
					var i = 0;
					for(var item_class_index in itemInfo.used_by_classes) {
						i++;
						var item_class = itemInfo.used_by_classes[item_class_index].toLowerCase();
						if(options.grouped_items[item_class] === undefined) {
							console.log(options.grouped_items);
							console.log("creating group " + item_class);
							options.grouped_items[item_class] = [];
						}
						options.grouped_items[item_class].push(item);

						if(i >= (itemInfo.used_by_classes.length - 1)) {
							groupItems(options, callback);
							break;
						}
					}
				} else {
					groupItems(options, callback);
				}
			} else {
				groupItems(options, callback);
			}
		} else {
			groupItems(options, callback);
		}
	} else {
		if(typeof(callback) == "function") {
			callback(options.grouped_items);
		}
	}
}

function groupMetal(options, callback) {
	if(options.items !== null && options.items.length > 0) {
		if(options.grouped_items === null) {
			options.grouped_items = {scrap: [], reclaimed: [], refined: []};
		}
		var item = options.items.pop();
		var defindex = item.defindex;
		// only "unique" items
		if(item.quality === 6) {
			// check if it is craftable
			if(item.flag_cannot_craft === undefined || !item.flag_cannot_craft) {
				// scrap
				if(defindex == metalIndexes.scrap) {
					options.grouped_items.scrap.push(item);
				} else if(defindex == metalIndexes.reclaimed) { // reclaimed
					options.grouped_items.reclaimed.push(item);
				} else if(defindex == metalIndexes.refined) { // refined
					options.grouped_items.refined.push(item);
				}

				groupMetal(options, callback);
			} else {
				groupMetal(options, callback);
			}
		} else {
			groupMetal(options, callback);
		}
	} else {
		if(typeof(callback) == "function") {
			callback(options.grouped_items);
		}
	}
}

function deleteCrates(user_items, callback) {
	if(crates_to_keep === null) {
		myLog.warning("crates_to_keep is null - will not delete crates without this defined");
	} else if(crate_series_cap === null) {
		myLog.warning("crate_series_cap is null - will not delete crates without this defined");
	} else {
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
				myLog.warning("[-] DELETING CRATES");
				for(var item_index in user_items) {
					var item = user_items[item_index];
					var defindex = item.defindex;
					var itemInfo = item_schema[defindex];

					if(itemInfo.item_class == "supply_crate") {
						myLog.warning("[-] " + itemInfo.name);
						for(var attribute_index in itemInfo.attributes) {
							if(itemInfo.attributes[attribute_index]['class'] == "supply_crate_series") {
								var series = itemInfo.attributes[attribute_index]['value'];
								if(crates_to_keep.indexOf(series) == -1 && series <= crate_series_cap) {
									tf2.deleteItem(item.id);
								}
							}
						}
					}
				}

				if(typeof(callback) == "function") {
					callback(true);
				}
			} else {
				if(typeof(callback) == "function") {
					callback("NOT deleting");
				}
			}
		});
	}
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
		var sortTypes = {0: "?", 1: "?", 2: "?", 3: "Quality", 4: "Type", 5: "Date"};
		var sortType = parseInt(result.sort);
		var sortName = "unknown";

		tf2.sortBackpack(sortType);
		if(typeof(callback) == "function") {
			if(sortTypes[sortType] != undefined) {
				sortName = sortTypes[sortType];
			}
			callback("Backpack has been sorted by " + sortName);
		}
	});
}

function userItemInfo(user_items, callback) {
	if(user_items.length > 0) {
		var item = user_items.pop();
		var defindex = item.defindex;
		var itemInfo = item_schema[defindex];
		myLog.info(JSON.stringify(item));
		myLog.info(JSON.stringify(itemInfo));
		userItemInfo(user_items, callback);
	} else {
		if(typeof(callback) == "function") {
			callback(true);
		}
	}
}

function isDefindexExcluded(defindex) {
	var excluded = [264, 572, 727, 452, 466, 638, 574, 298, 294, 297];
	if(excluded.indexOf(defindex) > -1) {
		myLog.add("[*] Excluding " + defindex);
		return true;
	}
	return false;
}

/**
 * Helper functions
 */

function getSchema(callback) {
	if(item_schema.length <= 0) {
		myLog.info("Getting schema...");
		var item_count = 0;

		steam_webapi.get("IEconItems_440", "GetSchema", 1, function(err, schema) {
			if(err) {
				// wait 5 seconds between tries
				setTimeout(function() {
					getSchema(callback)
				}, 5000);
			} else {
				if(schema.result !== undefined && schema.result.items !== undefined) {
					schema.result.items.forEach(function(item) {
						item_schema[item.defindex] = item;
						item_count++;

						if(item_count == schema.result.items.length && typeof(callback) == "function") {
							callback(true);
						}
					});
				} else {
					// wait 5 seconds between tries
					setTimeout(function() {
						getSchema(callback)
					}, 5000);
				}
			}
		});
	} else {
		if(typeof(callback) == "function") {
			callback(true);
		}
	}
}

function getItemInfo(item, callback) {
	var item_info = {};
	if(item_schema[item.defIndex] !== undefined) {
		item_info = item_schema[item.defIndex];
	} else {
		myLog.error("defindex " + item.defIndex + " not found in schema");
	}

	if(typeof(callback) == "function") {
		callback(item_info);
	}
}

function setupWebAPI(options, callback) {
	myLog.info("Setting up WebAPI...");
	steam_webapi = new SteamWebAPI(options.APIKey);
	myLog.success("WebAPI setup complete");
	if(typeof(callback) == "function") {
		callback(true);
	}
}

function getMySteamId(callback) {
	if(my_steamid === null) {
		if(account_config.steamid !== undefined) {
			my_steamid = account_config.steamid;
			myLog.warning("Setting my steam id from account_config: " + my_steamid);
		} else {
			if(admin_accounts[account_config.username] != undefined) {
				my_steamid = admin_accounts[account_config.username].id;
				myLog.warning("Setting my steam id from admin_accounts: " + my_steamid);
			} else {
				myLog.error(account_config.username + " is not a valid admin account");
			}
		}
	}

	if(typeof(callback) == "function" && my_steamid !== null) {
		callback(my_steamid);
	}
}

function loadMenu() {
	setTimeout(function() {
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
			var options = {SteamID: my_steamid};
			if(result.action == "exit") {
				process.exit();
			} else if(result.action == "scrap") {
				steam_webapi.get("IEconItems_440", "GetPlayerItems", 1, options, function(err, response) {
					if(response !== undefined) {
						if(response.result !== undefined && response.result.items !== undefined) {
							var items = response.result.items;
							groupItems({items: items, grouped_items: null}, function(grouped_items) {
								myLog.info("Scrapping");
								craftByGroup(grouped_items, 2, function() {
									loadMenu();
								});
							});
						}
					} else {
						myLog.error("GetPlayerItems failed");
						loadMenu();
					}
				});
			} else if(result.action == "smelt") {
				steam_webapi.get("IEconItems_440", "GetPlayerItems", 1, options, function(err, response) {
					if(response !== undefined) {
						if(response.result !== undefined && response.result.items !== undefined) {
							var items = response.result.items;
							groupMetal({items: items, grouped_items: null}, function(grouped_metal) {
								myLog.info("Smelting");
								craftByGroup(grouped_metal, 3, function() {
									loadMenu();
								});
							});
						}
					} else {
						myLog.error("GetPlayerItems failed");
						loadMenu();
					}
				});
			} else if(result.action == "delete") {
				steam_webapi.get("IEconItems_440", "GetPlayerItems", 1, options, function(err, response) {
					if(response !== undefined) {
						if(response.result !== undefined && response.result.items !== undefined) {
							var items = response.result.items;
							myLog.info("Deleting");
							deleteCrates(items, function(msg) {
								if(msg.length > 0) {
									myLog.info(msg);
								}
								loadMenu();
							});
						}
					} else {
						myLog.error("GetPlayerItems failed");
						loadMenu();
					}
				});
			} else if(result.action == "info") {
				steam_webapi.get("IEconItems_440", "GetPlayerItems", 1, options, function(err, response) {
					if(response !== undefined) {
						if(response.result !== undefined && response.result.items !== undefined) {
							var items = response.result.items;
							userItemInfo(items, function() {
								loadMenu();
							});
						}
					} else {
						myLog.error("GetPlayerItems failed");
						loadMenu();
					}
				});
			} else if(result.action == "sort") {
				myLog.info("Sorting");
				sortBackpack(function(msg) {
					if(msg.length > 0) {
						myLog.info(msg);
					}
					loadMenu();
				});
			} else {
				var msg = "#### \"" + result.action + "\" is not a valid action ####";
				myLog.error(msg);
				loadMenu();
			}
		});
	}, menu_wait);
}
