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
var SteamTrade = require('steam-trade');
var SteamWebapi = require('steam-webapi');
var mkdirp = require('mkdirp');
var nodemailer = require("nodemailer");
var mysql = require('mysql');
var tfprices = require('tfprices');

var SteamTradeOffers = require('steam-tradeoffers');
var offers = new SteamTradeOffers();

var admins = [];

var admin_logins = [];

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

// authentication vars
var sentryFile = null;

// steam bot vars
var bot = new steam.SteamClient();
var trade = new SteamTrade();
var item_schema = [];
var steam_webapi;

var item_account = null;
var metal_account = null;
var crate_account = null;
var my_steamid = null;

/**
 * Tracks the offers sent to prevent duplication of offers
 * @type {Array}
 */
var sentOffers = [];

/**
 * Monitor check interval in minutes
 *
 * @type {number}
 */
var monitor_interval = 1;

/**
 Logic
 */

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

// initialize log
var myLog = new logger(logDir + config.username + ".txt", true);


if(config.admin_logins) {
	admin_logins = config.admin_logins;
}

var prices = new tfprices(config.backpacktf_key);

function botLogon() {
	myLog.success('Attempting to logon bot for ' + config.username);
	// try to login with sentry file
	sentryFile = __dirname + '/sentries/sentryfile.' + config.username;
	if(fs.existsSync(sentryFile)) {
		myLog.success('Sentry file for ' + config.username + ' found.');
		bot.logOn({
			accountName: config.username,
			password: config.password,
			shaSentryfile: fs.readFileSync(sentryFile)
		});
	} else { // else ask for or generate a steamGuard auth code
		var steamGuardCode = null;
		if(args[1] != undefined) {
			steamGuardCode = args[1];
		}
		myLog.error('Sentry file for ' + config.username + ' does not exist.');
		bot.logOn({accountName: config.username, password: config.password, authCode: steamGuardCode});
	}
}

botLogon();

/**
 Bot listeners and calls
 */

// bot debug stuff
bot.on('debug', function(data) {
	myLog.info("BOT DEBUG: " + data);
});

bot.on('loggedOff', function() {
	// try to log back on
	botLogon();
});

// create sentry file
bot.on('sentry', function(sentryHash) {
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
bot.on('loggedOn', function() {
	myLog.success(config.username + " logged on!");
});

// create web session for trading
bot.on('webSessionID', function(sessionID) {
	myLog.info('Got a new session ID: ' + sessionID);
	bot.webLogOn(function(cookie) {
		setupOffers(sessionID, cookie, function() {
			runCheck(function() {
				startMonitor();
				processTradeOffers(null);
			});
		});
	});
});

bot.on('tradeOffers', function(number) {
	processTradeOffers(number);
});

/**
 * Helper functions
 */

/**
 *
 * @param sessionID
 * @param cookies
 * @param callback
 */
function setupOffers(sessionID, cookie, callback) {
	myLog.info("SETUP OFFERS");
	var options = {sessionID: sessionID, webCookie: cookie};
	offers.setup(options, function() {
		setupWebAPI(function() {
			getSchema(function() {
				getAdmins(admin_logins, function() {
					myLog.success("Ready for trade offers");
					if(typeof(callback) == "function") {
						callback(true);
					}
				});
			});
		});
	});
}

/**
 *
 * @param number
 */
function processTradeOffers(number) {
	myLog.info("Getting Trade offers");
	if(number == null || number > 0) {
		offers.getOffers({
			get_received_offers: 1,
			active_only: 1,
			time_historical_cutoff: Math.round(Date.now() / 1000)
		}, function(err, body) {
			if(body != undefined) {
				if(body.response.trade_offers_received) {
					myLog.info("Offers received");
					body.response.trade_offers_received.forEach(function(offer) {
						myLog.info("Offer ID: " + offer.tradeofferid);
						processOffer(offer, function(ret) {
							myLog.info("Trade was " + ret);
						});
					});
				}
			} else
				if(err) {
					myLog.error(err);
					// wait 5 seconds between tries
					setTimeout(function() {
						processTradeOffers(number)
					}, 5000);
				}
		});
	}
}

function getOfferStatus(trade_id, callback) {
	offers.getOffer({
		tradeofferid: trade_id
	}, function(err, trade) {
		if(err) {
			myLog.error(err);
			// wait 5 seconds between tries
			setTimeout(function() {
				checkOfferStatus(trade_id)
			}, 5000);
		} else {
			if(typeof(callback) == "function") {
				callback(trade.response.offer.trade_offer_state);
			}
		}
	});
}

function getSchema(callback) {
	if(item_schema.length <= 0) {
		myLog.info("Getting schema...");
		var item_count = 0;
		steam_webapi.getSchema({}, function(err, schema) {
			if(err) {
				// wait 5 seconds between tries
				setTimeout(function() {
					getSchema(callback)
				}, 5000);
			} else {
				schema.items.forEach(function(item) {
					item_schema[item.defindex] = item;
					item_count++;

					if(item_count == schema.items.length && typeof(callback) == "function") {
						callback(true);
					}
				});
			}
		});
	} else {
		if(typeof(callback) == "function") {
			callback(true);
		}
	}
}

function getTradeItemPrice(callback) {
	prices.getItemPrice(config.bot.item_id, function(pricing) {
		refinedToScrap(pricing.price, function(scrap) {
			if(typeof(callback) == "function") {
				callback(scrap);
			}
		});
	});
}

function refinedToScrap(price, callback) {
	if(typeof(callback) == "function") {
		callback(Math.ceil(price * 9));
	}
}

function processOffer(offer, callback) {
	try {
		if(offer.trade_offer_state == 2) {
			if(admins.indexOf(offer.steamid_other) >= 0) {
				myLog.success("Admin - Offer accepted");
				acceptTradeOffer(offer.tradeofferid);
				if(typeof(callback) == "function") {
					callback("accpeted");
				}
			} else {
				getTradeItemPrice(function(item_price) {
					myLog.chat("Trade item price: " + item_price);
					getTradeItems(offer.items_to_receive, "get", function(getDetails) {
						getTradeItems(offer.items_to_give, "give", function(giveDetails) {
							myLog.success("Done getting trade items");
							if(giveDetails.donations > 0) {
								myLog.error("Cancel trade - they are trying to get free stuff");
								declineTradeOffer(offer.tradeofferid);
								if(typeof(callback) == "function") {
									callback("declined");
								}
							} else {
								if(getDetails.tradeItems && giveDetails.tradeItems) {
									myLog.error("Cancel trade - both sides of trade contain Trade Item(s)");
									declineTradeOffer(offer.tradeofferid);
									if(typeof(callback) == "function") {
										callback("declined");
									}
								} else
									if(getDetails.tradeItems) {
										myLog.warning("Buying");
										purchaseScrapRequired(getDetails.tradeItems, item_price, function(scrap_required) {
											myLog.info("Scrap required: " + scrap_required);
											if(giveDetails.scrap <= scrap_required) {
												myLog.success("Got enough: " + giveDetails.scrap);
												acceptTradeOffer(offer.tradeofferid);
												if(typeof(callback) == "function") {
													callback("accpeted");
												}
											} else {
												myLog.error("Too much scrap requested: " + giveDetails.scrap);
												declineTradeOffer(offer.tradeofferid);
												if(typeof(callback) == "function") {
													callback("declined");
												}
											}
										});
									} else
										if(giveDetails.tradeItems) {
											myLog.warning("Selling");
											sellScrapRequired(giveDetails.tradeItems, item_price, function(scrap_required) {
												myLog.info("Scrap required: " + scrap_required);
												if(getDetails.scrap >= scrap_required) {
													myLog.success("Got enough: " + getDetails.scrap);
													acceptTradeOffer(offer.tradeofferid);
													if(typeof(callback) == "function") {
														callback("accpeted");
													}
												} else {
													myLog.error("Not enough scrap provided: " + getDetails.scrap);
													declineTradeOffer(offer.tradeofferid);
													if(typeof(callback) == "function") {
														callback("declined");
													}
												}
											});
										} else {
											// no trade item found...
											myLog.error("No trade item on either side");
											declineTradeOffer(offer.tradeofferid);
											if(typeof(callback) == "function") {
												callback("declined");
											}
										}
							}
						});
					});
				});
			}
		} else {
			myLog.error("Trade offer state is \"" + offer.trade_offer_state + "\" and not \"2\"");
			if(typeof(callback) == "function") {
				callback("invalid");
			}
		}
	} catch(err) {
		myLog.error(err);
		processOffer(offer, callback);
	}
}

function acceptTradeOffer(offer_id) {
	try {
		myLog.success("Accepting offer ID: " + offer_id);
		var options = {tradeOfferId: offer_id};
		offers.acceptOffer(options, function(err) {
			if(err) {
				myLog.error(err);
			}
		});
	} catch(err) {
		myLog.error(err);
		acceptTradeOffer(offer_id);
	}
}

function declineTradeOffer(offer_id) {
	try {
		myLog.error("Declining offer ID: " + offer_id);
		var options = {tradeOfferId: offer_id};
		offers.declineOffer(options, function(err) {
			if(err) {
				myLog.error(err);
			}
		});
	} catch(err) {
		myLog.error(err);
		declineTradeOffer(offer_id);
	}
}

function cancelTradeOffer(offer_id) {
	try {
		myLog.error("Cancelling offer ID: " + offer_id);
		var options = {tradeOfferId: offer_id};
		offers.cancelOffer(options, function(err) {
			if(err) {
				myLog.error(err);
			}
		});
	} catch(err) {
		myLog.error(err);
		cancelTradeOffer(offer_id);
	}
}

function sellScrapRequired(item_count, item_scrap, callback) {
	var scrap_required = item_count * item_scrap;
	if(typeof(callback) == "function") {
		callback(scrap_required);
	}
}

function purchaseScrapRequired(item_count, item_scrap, callback) {
	sellScrapRequired(item_count, item_scrap, function(scrap_required) {
		scrap_required -= 2;
		if(typeof(callback) == "function") {
			callback(scrap_required);
		}
	});
}

function getTradeItems(items, action, callback) {
	if(items) {
		var offerCounts = {scrap: 0, tradeItems: 0, donations: 0};
		myLog.info("Found " + items.length + " items to " + action);
		var item_count = 0;
		items.forEach(function(item) {
			getItemInfo(item, function(item_info) {
				var _thisItem = item_info[item.classid];
				item_count++;
				myLog.warning("\t" + _thisItem.name);
				if(_thisItem.app_data.def_index == config.bot.item_id) {
					offerCounts.tradeItems += 1;
				} else
					if(_thisItem.name == "Scrap Metal") {
						offerCounts.scrap += 1;
					} else
						if(_thisItem.name == "Reclaimed Metal") {
							offerCounts.scrap += 3;
						} else
							if(_thisItem.name == "Refined Metal") {
								offerCounts.scrap += 9;
							} else {
								offerCounts.donations += 1;
								myLog.warning("\t### DONATION ###");
							}

				if(item_count == items.length && typeof(callback) == "function") {
					callback(offerCounts);
				}
			});
		});
	} else {
		myLog.info("No items to " + action);
		if(typeof(callback) == "function") {
			callback(true);
		}
	}
}

function getItemInfo(item, callback) {
	steam_webapi.getAssetClassInfo({class_count: 1, classid0: item.classid}, function(err, item_info) {
		if(err) {
			myLog.error(err);
			setTimeout(function() {
				getItemInfo(item, callback)
			}, 5000);
		} else {
			if(typeof(callback) == "function") {
				callback(item_info);
			}
		}
	});
}

function setupWebAPI(callback) {
	myLog.info("Setting up WebAPI...");
	SteamWebapi.gameid = SteamWebapi.TF2;
	SteamWebapi.appid = SteamWebapi.TF2;
	SteamWebapi.key = offers.APIKey;

	SteamWebapi.ready(function(err) {
		if(err) return myLog.error(err);
		steam_webapi = new SteamWebapi();

		myLog.success("WebAPI setup complete");
		if(typeof(callback) == "function") {
			callback(true);
		}
	});
}

function getAdmins(logins, callback) {
	logins.forEach(function(login) {
		getSteamId(login, function(steamId) {
			if(steamId !== undefined) {
				myLog.info("Admin login/ID: " + login + " :: " + steamId);
				admins.push(steamId);
				if(admins.length == admin_logins.length && typeof(callback) == "function") {
					callback(true);
				}
			} else {
				// wait 5 seconds between tries
				setTimeout(function() {
					getAdmins([login], callback)
				}, 5000);
			}
		});
	});
}

function getSteamId(login, callback) {
	steam_webapi.resolveVanityURL({vanityurl: login}, function(err, user_info) {
		if(err) {
			myLog.error(err);
			// wait 5 seconds between tries
			setTimeout(function() {
				getSteamId(login, callback)
			}, 5000);
		} else {
			switch(login) {
				case config.item_account:
					item_account = user_info.steamid;
					break;
				case config.metal_account:
					metal_account = user_info.steamid;
					break;
				case config.crate_account:
					crate_account = user_info.steamid;
					break;
				case config.username:
				case config.vanity_name:
					my_steamid = user_info.steamid;
					break;
			}

			if(typeof(callback) == "function") {
				callback(user_info.steamid);
			}
		}
	});
}

function startMonitor() {
	myLog.warning("Starting inventory monitor with check interval of " + monitor_interval + " minutes");
	var the_interval = monitor_interval * 60 * 1000;
	var monitor = setInterval(function() {
		myLog.warning("I am doing my " + monitor_interval + " minutes check");
		isUserInGame(my_steamid, function(in_game) {
			if(!in_game) {
				getUserPersonaState(my_steamid, function(state) {
					if(state === steam.EPersonaState.Offline) {
						myLog.info("Setting persona state to \"Online\"");
						bot.setPersonaState(steam.EPersonaState.Online);
					}
				});
				// set the interval higher
				if(monitor_interval !== 30) {
					monitor_interval = 30;
					myLog.info("Changing check interval to " + monitor_interval);
					clearInterval(monitor);
					startMonitor();
				} else {

				}
			} else {
				//myLog.info("Persona state is already \"In Game\"");
				if(monitor_interval !== 5) {
					monitor_interval = 5;
					myLog.info("Changing check interval to " + monitor_interval);
					clearInterval(monitor);
					startMonitor();
				} else {
					runCheck();
				}
			}
		});
	}, the_interval);
}

function runCheck(callback) {
	if(my_steamid == null) {
		myLog.warning("My steamId is not set");
		var login = (config.vanity_name ? config.vanity_name : config.username);
		getSteamId(login, function(steamId) {
			myLog.warning("Setting my steam id: " + steamId);
			my_steamid = steamId;
			setTimeout(function() {
				runCheck(callback)
			}, 5000);
		});
	} else {
		myLog.warning("Running check");
		getNewUserItems(my_steamid, function(trade_items) {
			makeOffers(trade_items);
		});
		if(typeof(callback) == "function") {
			callback(true);
		}
	}
}

function makeOffers(grouped_items) {
	var partnerSteamId = null;
	var msg = null;
	for(var type in grouped_items) {
		switch(type) {
			case "metal":
				if(metal_account != my_steamid) {
					partnerSteamId = metal_account;
					trade_items = grouped_items.metal;
					msg = "you can has metal";
				}
				break;
			case "crates":
				if(crate_account != my_steamid) {
					partnerSteamId = crate_account;
					trade_items = grouped_items.crates;
					msg = "you can has crates";
				}
				break;
			case "items":
				if(item_account != my_steamid) {
					partnerSteamId = item_account;
					trade_items = grouped_items.items;
					msg = "you can has items";
				}
				break;
		}
		if(partnerSteamId != null && trade_items.length > 0) {
			myLog.chat("Making " + type + " offer");
			makeOffer({
				partnerSteamId: partnerSteamId,
				itemsFromMe: trade_items,
				itemsFromThem: [],
				message: msg
			}, true);
		}
		partnerSteamId = null;
		msg = null;
	}
}

function makeOffer(options, persist, callback) {
	offers.makeOffer(options, function(err, trade_res) {
		console.log(options);
		if(err) {
			myLog.error(err);

			// do not keep trying if the persist flag is false
			if(!persist) {
				return;
			}
			if(/\(16\)$/.test(err)) {
				// the trade probably worked
				myLog.success("This error is often returned in error; assuming successful");

			} else
				if(/\(26\)$/.test(err)) {
					// need to receive an item through trade before making this trade
					myLog.warning("The item(s) being traded are not visible to the trade offer system - need to receive a new item via trade to rectify this");
					// make a trade request for an item in the item_account inventory - probably the spell magazine (defindex: 1070)
					getTradeItemByDefindex('1070', item_account, function(item) {
						createTradeItem(item, function(tradeItem) {
							// need to wait until trade has been accepted, add the item received to the initial trade, then try again.
							makeOffer({
								partnerSteamId: options.partnerSteamId,
								itemsFromMe: [],
								itemsFromThem: [tradeItem],
								message: "Getting item from item_account"
							}, false, function(trade_id) {
								waitForTradeToComplete(trade_id, function() {
									options.itemsFromMe.push(tradeItem);
									makeOffer(options, true, callback);
								});
							});
						});
					});
				} else
					if(/\(25\)$/.test(err)) {
						// too many pending offers to the same account - this should be addressed by not creating multiple trade requests with the same item
						myLog.warning("There are 5 pending trade offers with the account: " + options.partnerSteamId);

					} else
						if(err == "SyntaxError: Unexpected token <") {
							// something is wrong with the trade system or your steam session - may need to log in somewhere else
							myLog.warning("something is wrong with the trade system");

						} else
							if(err == "Error: 403") {
								// something is wrong with the trade system or your steam session - may need to log in somewhere else
								myLog.warning("something is wrong with the trade system or your steam session - may need to log in somewhere else");

							} else {
								/**
								 * COMMON ERRORS
								 *
								 * Error: 401
								 */

									// wait 5 seconds between tries
								myLog.warning("waiting 5 seconds between tries");
								setTimeout(function() {
									makeOffer(options, true, callback)
								}, 5000);
							}
		} else {
			myLog.success("Offer creation successful: " + trade_res.tradeofferid);
			sentOffers.push(trade_res.tradeofferid);
		}
	});
}

function waitForTradeToComplete(trade_id, callback) {
	var completed = false;

	while(!completed) {
		getOfferStatus(trade_id, function(trade_status) {
			switch(trade_status) {
				case 2:
					// trade is still active
					break;
				case 1:
				case 4:
					cancelTradeOffer(trade_id);
					completed = true;
					break;
				default:
					completed = true;
					break;
			}

			if(typeof(callback) == "function" && completed) {
				callback(completed);
			} else {
				setTimeout(function() {
					myLog.warning("Waiting for trade to complete");
				}, 5000);
			}
		});
	}
}

function isUserInGame(user_id, callback) {
	getPlayerSummary(user_id, function(player_summary) {
		var ret_val = false;
		if(player_summary.gameid !== undefined && player_summary.gameid == 440) {
			ret_val = true;
		}
		if(typeof(callback) == "function") {
			callback(ret_val);
		}
	});
}

function getUserPersonaState(user_id, callback) {
	getPlayerSummary(user_id, function(player_summary) {
		callback(player_summary.personastate);
	});
}

function getPlayerSummary(user_id, callback) {
	steam_webapi.getPlayerSummaries({steamids: user_id}, function(err, results) {
		if(err) {
			myLog.error(err);
			// wait 5 seconds between tries
			setTimeout(function() {
				getPlayerSummary(user_id, callback)
			}, 5000);
		} else {
			callback(results.players[0]);
		}
	});
}

function getNewUserItems(user_id, callback) {
	steam_webapi.getPlayerItems({steamid: user_id}, function(err, user_items) {
		if(user_items !== undefined && user_items.items !== undefined) {
			var new_items = {metal: [], crates: [], items: []};
			var count = 0;
			user_items.items.forEach(function(item) {
				count++;
				getItemInventoryInfo(item.inventory, function(inventory_info) {
					if(!inventory_info.in_backpack) {
						createTradeItem(item, function(trade_item) {
							if(config.bot.item_id && item.defindex == config.bot.item_id) {
								// do not trade away a trade item
							} else {
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
							}
						});
					}

					if(typeof(callback) == "function" && count == user_items.items.length) {
						callback(new_items);
					}
				});
			});
		} else {
			// wait 5 seconds between tries
			myLog.warning("Unable to get user inventory");
			setTimeout(function() {
				getNewUserItems(user_id, callback)
			}, 5000);
		}
	});
}

function getItemInventoryInfo(inventory_id, callback) {
	var bin = inventory_id.toString(2);
	var bin_split = bin.split("");
	var ret_val = {};
	ret_val.in_backpack = (bin_split[1] == 1 ? false : true);
	var location = "";
	for(var i = 16; i <= 31; i++) {
		location += bin_split[i].toString();
	}
	ret_val.location = parseInt(location, 2);
	callback(ret_val);
}

function createTradeItem(item, callback) {
	var tradeItem = {
		"appid": 440,
		"contextid": 2,
		"amount": 1,
		"assetid": item.id.toString()
	};

	if(typeof(callback) == "function") {
		callback(tradeItem);
	}
}

function getTradeItemByDefindex(defindex, steamid, callback) {
	console.log(defindex);
	steam_webapi.getPlayerItems({steamid: steamid}, function(err, user_items) {
		var items = [];
		var count = 0;
		user_items.items.forEach(function(item) {
			if(item.defindex == defindex) {
				if(typeof(callback) == "function") {
					callback(item);
				}
			}
		});
	});
}
