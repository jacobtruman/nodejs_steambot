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
var myLog = new logger(logDir + config.username + ".txt", true);

// authentication vars
var sentryFile = null;

// steam bot vars
var bot = new steam.SteamClient();
var trade = new SteamTrade();
var steam_webapi;

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

if(config.admin_logins) {
	admin_logins = config.admin_logins;
}

var prices = new tfprices(config.backpacktf_key);

// try to login with sentry file
sentryFile = 'sentries/sentryfile.' + config.username;
if(fs.existsSync(sentryFile)) {
	myLog.success('Sentry file for ' + config.username + ' found.');
	bot.logOn({accountName: config.username, password: config.password, shaSentryfile: fs.readFileSync(sentryFile)});
} else { // else ask for or generate a steamGuard auth code
	var steamGuardCode = null;
	if(args[1] != undefined) {
		steamGuardCode = args[1];
	}
	myLog.error('Sentry file for ' + config.username + ' does not exist.');
	bot.logOn({accountName: config.username, password: config.password, authCode: steamGuardCode});
}

/**
 Bot listeners and calls
 */

// bot debug stuff
bot.on('debug', function(data) {
	myLog.info("BOT DEBUG: " + data);
});

// create sentry file
bot.on('sentry',function(sentryHash) {
	myLog.info("Creating sentry file");
	fs.writeFile(sentryFile,sentryHash,function(err) {
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
	bot.webLogOn(function(cookies) {
		setupOffers(sessionID, cookies, function() {
			processTradeOffers(null, function() {
				// not sure this needs to be here...
			});
			bot.setPersonaState(steam.EPersonaState.Online);
		});
	});
});

bot.on('tradeOffers', function(number) {
	processTradeOffers(number, function() {
		// not sure this needs to be here...
	});
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
function setupOffers(sessionID, cookies, callback) {
	myLog.info("SETUP OFFERS");
	var options = {sessionID: sessionID, webCookie:cookies};
	offers.setup(options, function() {
		setupWebAPI(function() {
			getAdmins(function() {
				myLog.success("Ready for trade offers");
				if(typeof(callback) == "function") {
					callback(true);
				}
			});
		});
	});
}

/**
 *
 * @param number
 */
function processTradeOffers(number, callback) {
	myLog.info("Getting Trade offers");
	if (number == null || number > 0) {
		offers.getOffers({
			get_received_offers: 1,
			active_only: 1,
			time_historical_cutoff: Math.round(Date.now() / 1000)
		}, function(error, body) {
			if(body != undefined){
				if(body.response.trade_offers_received){
					myLog.info("Offers received");
					body.response.trade_offers_received.forEach(function(offer) {
						myLog.info("Offer ID: "+offer.tradeofferid);
						processOffer(offer);
					});
				}
			} else if(error) {
				myLog.error(error);
			}
		});
	}
}

function getTradeItemPrice(callback) {
	if(config.bot.item_price) {
		callback(config.bot.item_price);
	} else {
		prices.getItemPrice(config.bot.item_id, function(pricing) {
			refinedToScrap(pricing.price, function(scrap) {
				if(typeof(callback) == "function") {
					callback(scrap);
				}
			});
		});
	}
}

function refinedToScrap(price, callback) {
	if(typeof(callback) == "function") {
		callback(Math.ceil(price * 9));
	}
}

function processOffer(offer) {

	if (offer.trade_offer_state == 2){
		if(admins.indexOf(offer.steamid_other) >= 0) {
			myLog.success("Admin - Offer accepted");
			acceptTradeOffer(offer.tradeofferid);
		} else {
			getTradeItemPrice(function(item_price) {
				myLog.chat("Trade item price: "+item_price);
				getTradeItems(offer.items_to_receive, function(getDetails) {
					getTradeItems(offer.items_to_give, function(giveDetails) {
						myLog.success("Done getting trade items");
						if(giveDetails.donations > 0) {
							myLog.error("Cancel trade - they are trying to get free stuff");
							declineTradeOffer(offer.tradeofferid);
						} else {
							if(getDetails.tradeItems && giveDetails.tradeItems) {
								myLog.error("Cancel trade - both sides of trade contain Trade Item(s)");
								declineTradeOffer(offer.tradeofferid);
							} else if(getDetails.tradeItems) {
								myLog.warning("Buying");
								purchaseScrapRequired(getDetails.tradeItems, item_price, function(scrap_required) {
									myLog.info("Scrap required: "+scrap_required);
									if(giveDetails.scrap <= scrap_required) {
										myLog.success("Got enough: "+giveDetails.scrap);
										acceptTradeOffer(offer.tradeofferid);
									} else {
										myLog.error("Too much scrap requested: "+giveDetails.scrap);
										declineTradeOffer(offer.tradeofferid);
									}
								});
							} else if(giveDetails.tradeItems) {
								myLog.warning("Selling");
								sellScrapRequired(giveDetails.tradeItems, item_price, function(scrap_required) {
									myLog.info("Scrap required: "+scrap_required);
									if(getDetails.scrap >= scrap_required) {
										myLog.success("Got enough: "+getDetails.scrap);
										acceptTradeOffer(offer.tradeofferid);
									} else {
										myLog.error("Not enough scrap provided: "+getDetails.scrap);
										declineTradeOffer(offer.tradeofferid);
									}
								});
							}
						}
					});
				});
			});
		}
	} else {
		myLog.error("Trade offer state is \""+offer.trade_offer_state+"\" and not \"2\"");
	}
}

function acceptTradeOffer(offer_id) {
	myLog.success("Accepting offer ID: "+offer_id);
	var options = {tradeOfferId:offer_id}
	offers.acceptOffer(options, function(trade_error) {
		if (trade_error != null) {
			myLog.error(trade_error);
		}
	});
}

function declineTradeOffer(offer_id) {
	myLog.error("Declining offer ID: "+offer_id);
	offers.declineOffer(offer_id, function(trade_error) {
		if (trade_error != null) {
			myLog.error(trade_error);
		}
	});
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

function getTradeItems(items, callback) {
	if(items) {
		var offerCounts = {scrap:0, tradeItems:0, donations:0};
		myLog.info("Found "+items.length+" items to give");
		var item_count = 0;
		items.forEach(function(item) {
			steam_webapi.getAssetClassInfo({class_count:1, classid0:item.classid}, function(err, item_info) {
				var _thisItem = item_info[item.classid];
				item_count++;
				myLog.warning("\t"+_thisItem.name);
				if(_thisItem.app_data.def_index == config.bot.item_id) {
					offerCounts.tradeItems += 1;
				} else if(_thisItem.name == "Scrap Metal") {
					offerCounts.scrap += 1;
				} else if(_thisItem.name == "Reclaimed Metal") {
					offerCounts.scrap += 3;
				} else if(_thisItem.name == "Refined Metal") {
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
		myLog.info("No items to give");
		if(typeof(callback) == "function") {
			callback(true);
		}
	}
}

function setupWebAPI(callback) {
	myLog.info("Setting up WebAPI...");
	SteamWebapi.gameid = SteamWebapi.TF2;
	SteamWebapi.appid = SteamWebapi.TF2
	SteamWebapi.key = offers.APIKey;

	SteamWebapi.ready(function(err) {
		if (err) return myLog.error(err);
		steam_webapi = new SteamWebapi();

		myLog.success("WebAPI setup complete");
		if(typeof(callback) == "function") {
			callback(true);
		}
	});
}

function getAdmins(callback) {
	admin_logins.forEach(function(login) {
		steam_webapi.resolveVanityURL({vanityurl:login}, function(err, user_info) {
			admins.push(user_info.steamid);
			myLog.info("Admin login/ID: "+login+" :: "+user_info.steamid);
			if(admins.length == admin_logins.length && typeof(callback) == "function") {
				callback(true);
			}
		});
	});
}
