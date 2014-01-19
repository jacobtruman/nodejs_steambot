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
var myLog = new logger(logDir + config.username + ".txt");

// authentication vars
var sentryFile = null;
var steamGuardCode = null; // change this to be passed in as a parameter

// inventory var
var inventoryType = 440; // 440 is TF2

// steam bot vars
var bot = new steam.SteamClient();
var trade = new SteamTrade();
var client;

/**
The mode of the bot
options include:
	give - bot puts up all non-metal/non-crate items
	donate - bot accepts whatever is put up by the other user
	sell - bot is selling item(s); only accepts metal and puts up *item(s)*
	buy - bot is buying item(s); only accepts *item(s)* and puts up metal
*/
var theMode = null;

// inventory vars
var inventory = [];
var tradeItems = []; // array of items to buy/sell
var crates = []; // array of crates
var scrap = []; // array of scrap
var reclaimed = []; // array of reclaimed
var refined = []; // array of refined

var scrapAdded = [];
var reclaimedAdded = [];
var refinedAdded = [];

// items added
var addedItem = [];
var addedScrap = 0;
var totalMetal = 0;
var theyAdded = [];

// misc vars
var value;
var itemSalePrice = 1000;
// amount of margin in scrap
var itemSaleMargin = 2;

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

var prices = new tfprices(config.backpacktf_key);

// try to login with sentry file
sentryFile = 'sentries/sentryfile.' + config.username;
if(fs.existsSync(sentryFile)) {
	myLog.success('Sentry file for ' + config.username + ' found.');
	bot.logOn({accountName: config.username, password: config.password, shaSentryfile: fs.readFileSync(sentryFile)});
} else { // else ask for or generate a steamGuard auth code
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

trade.on('chatMsg', function(msg) {
	myLog.chat("(trade) " + msg);
	if (msg == 'give') {
		setMode("give");
		myLog.warning('Asking for all non-metal and non-crate items');
		if(isAdmin(client)) {
			myLog.warning('Admin');
			var nonScrap = inventory.filter(function(item) {
				return !~crates.indexOf(item) && !~scrap.indexOf(item);
			});
			trade.addItems(nonScrap);
		}
	} else if(msg == 'donate') {
		setMode("donate");
	}
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

// listen for chat messages
bot.on('message', function(source, message, type, chatter) {
	// respond to both chat room and private messages
	if(type == 1) {
		myLog.chat(message);
		if (message == 'ping') {
			bot.sendMessage(source, 'pong', steam.EChatEntryType.ChatMsg); // ChatMsg by default
		}
	}
});

bot.on('relationships', function() {
	// add all friend requests
	var friendsToAdd = [];
	for (var i in bot.friends) {
		if (bot.friends[i] == steam.EFriendRelationship.PendingInvitee) {
			friendsToAdd.push(i);
		}
	}
	friendsToAdd.forEach(function(steamID) {
		myLog.info("Adding friend with id " + steamID);
		bot.addFriend(steamID);
	});
});

bot.on('friend', function(id, type) {
	if (type == steam.EFriendRelationship.PendingInvitee) {
		myLog.info("Adding friend with id " + id);
		bot.addFriend(id);
	}

	if (type == steam.EFriendRelationship.None) {
		myLog.info("Removed by friend with id " + id);
	}
});

// create web session for trading
bot.on('webSessionID', function(sessionID) {
	myLog.info('Got a new session ID: ' + sessionID);
	trade.sessionID = sessionID;
	bot.webLogOn(function(cookies) {
		for(key in cookies){
			cookie = cookies[key];
			myLog.info('\tGot a new cookie: '+cookie);
			trade.setCookie(cookie);
		}
		loadInventory(bot.setPersonaState(steam.EPersonaState.Online));
	});
});

// accept trade
bot.on('tradeProposed', function(id, steamid){
	bot.respondToTrade(id, true);
});

// trade session satarted
bot.on('sessionStart', function(steamid){
	client = steamid;
	myLog.warning("Trade accepted with " + bot.users[steamid].playerName);

	// reload the inventory
	loadInventory(function(res1) {
		trade.open(steamid, function(res2) {
			if(config.bot.purchase_price > 0 && config.bot.sale_price > 0) {
				buysell = "buying/selling";
			} else if(config.bot.purchase_price > 0) {
				buysell = "buying";
			} else if(config.bot.sale_price > 0) {
				buysell = "selling";
			}
			trade.chatMsg("I am but a humble bot, " + buysell + " " + config.bot.item + "(s)", function(res3) {
				trade.chatMsg("Current stock: " + tradeItems.length)
			});
		});
	});
});

// trade logic
trade.on('offerChanged', function(added, item) {
	prices.getItemPrice(item.app_data.def_index, function() {
		itemSalePrice = prices.price;
		myLog.warning('They ' + (added ? 'added ' : 'removed ') + item.name);
		if (added) {
			if(item.name.indexOf("Metal") >= 0) {
				if(theMode == null) {
					setMode("sell");
					myLog.warning('They want ' + config.bot.item);
				}
			} else if(theMode == null && isTradeItem(item)) {
				setMode("buy");
			} else if(item.name.indexOf("Metal") >= 0 && isTradeItem(item)) {
				trade.chatMsg("I only accept metal or " + config.bot.item + "(s)");
				myLog.warning("Added unsupported item");
			}

			if(theMode == "sell") {
				if(tradeItems.length > 0) {
					toggleMetal(item.name, "add");
					console.log(addedScrap);
					if(addedScrap < getSaleScrapRequired()) {
						myLog.warning("Not enough yet: " + getSaleScrapRequired());
					} else {
						var newItem;
						var newItems = [];
						myLog.warning("BOOM - got enough");
						newItem = toggleItem("add");
						newItems.push(newItem);
						addedItem.push(newItem);
						trade.addItems(newItems);
					}
				}
			} else if(theMode == "buy") {
				theyAdded.push(item);
				// don't add metal unless they added a trade item
				if(isTradeItem(item)) {
					var toBeAdded = [];
					if(totalMetal >= getPurchaseScrapRequired()) {
						while(addedScrap < getPurchaseScrapRequired()) {
							myLog.warning("Not enough yet: " + getPurchaseScrapRequired());
							if(getPurchaseScrapRequired() - addedScrap >= 9 && refined.length > 0) {
								toBeAdded.push(toggleMetal("Refined Metal", "add"));
							} else if(getPurchaseScrapRequired() - addedScrap >= 3 && reclaimed.length > 0) {
								toBeAdded.push(toggleMetal("Reclaimed Metal", "add"));
							} else if(scrap.length > 0) {
								toBeAdded.push(toggleMetal("Scrap Metal", "add"));
							}
						}
						trade.addItems(toBeAdded);
					}
				}
			} else if(theMode == "donate") {
				// do nothing
			} else if(theMode == "give") {
				// do nothing
			}
		} else if (!added) {
			if(theMode == "buy") {
				theyAdded.splice(theyAdded.indexOf(), 1);
				// don't remove metal unless they removed a trade item
				if(isTradeItem()) {
					if(addedScrap >= getPurchaseScrapRequired()) {
						var countToBeRemoved = getPurchaseScrapRequired();
						var toBeRemoved = [];
						var itemName;
						while(countToBeRemoved > 0) {
							if(countToBeRemoved >= 9 && refinedAdded.length > 0) {
								itemName = "Refined Metal";
								countToBeRemoved -= 9;
							} else if(countToBeRemoved >= 3 && reclaimedAdded.length > 0) {
								itemName = "Reclaimed Metal";
								countToBeRemoved -= 3;
							} else if(countToBeRemoved > 0 && scrapAdded.length > 0) {
								itemName = "Scrap Metal";
								countToBeRemoved -= 1;
							}
							trade.removeItem(toggleMetal(itemName, "remove"));
						}
					}
				}
			} else if(theMode == "sell") {
				var itemToRemove = toggleItem("remove");
				if(itemToRemove != undefined) {
					trade.removeItem(itemToRemove);
				}
			}
		}
	});
});

trade.on('ready', function() {
  myLog.warning('Readying');
  trade.ready(function() {
  	if(validateTrade()) {
		myLog.warning('Confirming');
		trade.confirm();
  	} else {
  		myLog.error('Something went wrong with the trade, canceling');
  		trade.cancel();
  	}
  });
});

trade.on('end', function(result) {
	// 'complete', 'empty' (no items on either side), 'cancelled', 'timeout' or 'failed'
	myLog.warning('Trade ' + result);
	var msg;
	switch(result) {
		case "complete":
			msg = 'Thank you for trading';
			break;
		case "empty":
			msg = 'Trade was empty';
			break;
		case "cancelled":
			msg = 'Trade was cancelled';
			break;
		case "timeout":
			msg = 'Trade timed out';
			break;
		case "failed":
			msg = 'Trade failed';
			break;
	}
	bot.sendMessage(bot.steamID, msg, steam.EChatEntryType.ChatMsg);
	//sendEmail("", "");

	// reset bot
	reset();
});


/**
Helper functions
*/

// check if logged in user is an admin for the bot
function isAdmin(steamID){
	myLog.info('Checking if admin: ' + steamID);
	if(config.admins.indexOf(steamID) >= 0){
		return true;
	}else{
		return false;
	}
}

function isTradeItem(item) {
	if(item.name == config.bot.item) {
		return true;
	} else {
		return false;
	}
}

function loadInventory(callback) {
	myLog.info("LOADING INVENTORY");
	trade.loadInventory(inventoryType, 2, function(inv) {
		inventory = inv;
		// get objects from inventory
		getMetalFromInv(inventory);
		getTradeItemsFromInv(inventory);
		getCratesFromInv(inventory);
		checkGlobalCounts();
		if(typeof(callback) == "function") {
			callback(true);
		}
	});
}

function checkGlobalCounts() {
	myLog.warning("\tTrade Items: " + tradeItems.length);
	myLog.warning("\tRefined Metal: " + refined.length);
	myLog.warning("\tReclaimed Metal: " + reclaimed.length);
	myLog.warning("\tScrap Metal: " + scrap.length);

	myLog.warning("\tInventory: " + inventory.length);
	myLog.warning("\tCrates: " + crates.length);

	myLog.warning("\tScrap Added:" + scrapAdded.length);
	myLog.warning("\tReclaimed Added:" + reclaimedAdded.length);
	myLog.warning("\tRefined Added:" + refinedAdded.length);

	myLog.warning("\tItems Added:" + addedItem.length);
	myLog.warning("\tAdded Scrap: " + addedScrap);
	myLog.warning("\tMetal Added: " + totalMetal);
	myLog.warning("\tThey Added: " + theyAdded.length);
}

function getCratesFromInv(inv) {
	crates = inv.filter(function(item) {
		return item.name.indexOf("Supply Crate") !== -1;
	});
}

function getMetalFromInv(inv) {
	scrap = inv.filter(function(item) {
		return item.name == 'Scrap Metal';
	});
	reclaimed = inv.filter(function(item) {
		return item.name == 'Reclaimed Metal';
	});
	refined = inv.filter(function(item) {
		return item.name == 'Refined Metal';
	});
	totalMetal = scrap.length + (reclaimed.length * 3) + (refined.length * 9);
}

function getTradeItemsFromInv(inv) {
	tradeItems = inv.filter(function(item) {
		return item.name == config.bot.item;
	});
}

function toggleItem(action) {
	if(action == "add") {
		if(tradeItems.length > 0) {
			thisItem = tradeItems.pop();
		} else {
			myLog.warning("No more items to add");
		}
	} else if (action == "remove") {
		thisItem = addedItem.pop();
		tradeItems.push(thisItem);

		if(addedItem.length <= 0) {
			if(addedScrap > 0) {
				setMode("buy");
			} else {
				setMode(null);
			}
		}
	}
	
	return thisItem;
}

function getSaleScrapRequired() {
	// multiply by nine and round up
	return getScrapRequired(itemSalePrice);
}

function getPurchaseScrapRequired(item) {
	// multiply by nine and round up
	var multiplier = theyAdded.length > 0 ? theyAdded.length : 1;
	return (getScrapRequired(itemSalePrice) * multiplier) - itemSaleMargin;
}

function getScrapRequired(val) {
	return Math.ceil(val * 9);
}

function toggleMetal(name, action) {
	var thisItem; // the item to be added or removed
	var tradeMetal; // array of the type of metal to be added or removed
	var tradeMetalAdded; // array of the type of metal to be added to or removed from
	switch (name) {
		case 'Scrap Metal':
			tradeMetal = scrap;
			tradeMetalAdded = scrapAdded;
			value = 1;
			break;
		case 'Reclaimed Metal':
			tradeMetal = reclaimed;
			tradeMetalAdded = reclaimedAdded;
			value = 3;
			break;
		case 'Refined Metal':
			tradeMetal = refined;
			tradeMetalAdded = refinedAdded;
			value = 9;
			break;
	}

	if(action == "add") {
		myLog.warning("Adding "+name);
		addedScrap += value;
		if(theMode == "buy") {
			thisItem = tradeMetal.pop();
			tradeMetalAdded.push(thisItem);
			addedItem.push(thisItem);
		}
	} else if(action == "remove") {
		myLog.warning("Removing "+name);
		addedScrap -= value;
		if(theMode == "buy") {
			thisItem = tradeMetalAdded.pop();
			addedItem.splice(addedItem.indexOf(thisItem), 1);
			tradeMetal.push(thisItem);
		}
	}
	// reset the mode if all scrap is removed
	if(theMode == "buy" && addedScrap == 0) {
		if(addedItem.length > 0) {
			setMode("sell");
		} else {
			setMode(null);
		}
	}

	return thisItem;
}

function validateTrade() {
	myLog.warning('Validating trade');

	if(theMode == "sell") {
		console.log(getCounts(trade.themAssets));
		console.log(addedItem.length * config.bot.sale_price);
		if(getCounts(trade.themAssets) < addedItem.length * getSaleScrapRequired()) {
			myLog.error('Careful, it looks like they are trying to screw you');
		} else if(getCounts(trade.themAssets) > addedItem.length * config.bot.sale_price) {
			myLog.info('They are overpaying - warn them');
			trade.chatMsg('It looks like you added too much, you can overpay if you want to');
		}
	} else if(theMode == "buy") {
		// make sure the correct number of items have been added
	} else if(theMode == "give") {
		// nothing to validate
	} else if(theMode == "donate") {
		// nothing to validate
	}

	return true;
}

function getCounts(itemList) {
	//metal counts
	var addedMetalCount = 0;
	var addedScrapCount = 0;
	var addedReclaimedCount = 0;
	var addedRefinedCount = 0;

	// item count
	var addedItemCount = 0;

	addedScrapCount = itemList.filter(function(item) {
		return item.name == 'Scrap Metal';
	});

	addedReclaimedCount = itemList.filter(function(item) {
		return item.name == 'Reclaimed Metal';
	});

	addedRefinedCount = itemList.filter(function(item) {
		return item.name == 'Refined Metal';
	});

	addedMetalCount = addedScrapCount.length + (addedReclaimedCount.length * 3) + (addedRefinedCount.length * 9);

	addedItemCount = itemList.filter(function(item) {
		return item.name == config.bot.item;
	});

	return addedMetalCount;
}

function setMode(mode, force) {
	force = force || false;
	if((theMode != "give" && theMode != "donate") || force) {
		theMode = mode;
		myLog.info("MODE CHANGED TO \""+theMode+"\"");
	} else {
		myLog.info("MODE WAS NOT CHANGED \""+theMode+"\"");
	}
}

function reset() {
	myLog.info("RESETTING BOT");
	inventory.length = 0;
	tradeItems.length = 0;
	crates.length = 0;
	scrap.length = 0;
	reclaimed.length = 0;
	refined.length = 0;

	scrapAdded.length = 0;
	reclaimedAdded.length = 0;
	refinedAdded.length = 0;

	addedItem.length = 0;
	theyAdded.length = 0;

	addedScrap = 0;
	totalMetal = 0;

	setMode(null, true);
}

// EXAMPLE USAGE
//sendEmail("Sale made!", config.username + " made a sale!");
function sendEmail(subject, msg)
{
	// don't do anything if the notify email has not been defined.
	if(config.notifications.smtp_email && config.notifications.smtp_password && config.notifications.notify_emails) {
		// create reusable transport method (opens pool of SMTP connections)
		var smtpTransport = nodemailer.createTransport("SMTP",{
		    service: "Gmail",
		    auth: {
		        user: config.notifications.smtp_email,
		        pass: config.notifications.smtp_password
		    }
		});

		// setup e-mail data with unicode symbols
		var mailOptions = {
			from: config.notifications.smtp_email, // sender address
			bcc: config.notifications.notify_emails.toString(), // list of receivers
			subject: subject, // Subject line
			text: msg, // plaintext body
			html: "<b>" + msg + "</b>" // html body
		}

		// send mail with defined transport object
		smtpTransport.sendMail(mailOptions, function(error, response) {
				if(error) {
					myLog.error(error);
				} else {
					myLog.info("Email sent: " + response.message);
				}

			// if you don't want to use this transport object anymore, uncomment following line
			smtpTransport.close(); // shut down the connection pool, no more messages
		});
	} else {
		myLog.error("Email notification not sent - notify_email not defined in config\n\n\t\t" + subject + "\n\t\t" + msg);
	}
}
