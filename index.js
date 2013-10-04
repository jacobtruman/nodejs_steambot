// requires
var fs = require('fs');
var logger = require('tru-logger');
var steam = require('steam');
var SteamTrade = require('steam-trade');
var mkdirp = require('mkdirp');
var nodemailer = require("nodemailer");

// cli paramters
var args = process.argv.splice(2);

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

// variables
var logDir = __dirname + "/logs/";
mkdirp(logDir, function(err) {
	// path was created unless there was error
});
var myLog = new logger(logDir + config.username + ".txt");

// authentication vars
var sentryFile = 'sentries/sentryfile.' + config.username;
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
var inventory;
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

// bot debug stuff
bot.on('debug', function(data) {
	myLog.info("BOT DEBUG: " + data);
});

// make sure there is a username defined
if(config.username == undefined) {
	throw new Error("Please specify username");
}

// check if logged in user is an admin for the bot
function isAdmin(steamID){
	myLog.info('Checking if admin: ' + steamID);
	if(config.admins.indexOf(steamID) >= 0){
		return true;
	}else{
		return false;
	}
}

// try to login with sentry file
if(fs.existsSync(sentryFile)) {
	myLog.success('Sentry file for ' + config.username + ' found.');
	bot.logOn({accountName: config.username, password: config.password, shaSentryfile: fs.readFileSync(sentryFile)});
} else { // else ask for or generate a steamGuard auth code
	myLog.error('Sentry file for ' + config.username + ' does not exist.');
	bot.logOn({accountName: config.username, password: config.password, authCode: steamGuardCode});
}

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
			trade.loadInventory(inventoryType, 2, function(inv) {
				inventory = inv;
				bot.setPersonaState(steam.EPersonaState.Online);
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
				tradeItems = inv.filter(function(item) {
					return item.name == config.bot.item;
				});
				crates = inv.filter(function(item) {
					return item.name.indexOf("Supply Crate") !== -1;
				});
			});
		}
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
	trade.open(steamid);
	
	if(config.bot.purchase_price > 0 && config.bot.sale_price > 0) {
		buysell = "buying/selling";
	} else if(config.bot.purchase_price > 0) {
		buysell = "buying";
	} else if(config.bot.sale_price > 0) {
		buysell = "selling";
	}
	trade.chatMsg("I am but a humble bot, " + buysell + " " + config.bot.item + "(s)");
	trade.chatMsg("Current stock: " + tradeItems.length);
});

// trade logic
trade.on('offerChanged', function(added, item) {
	myLog.warning('They ' + (added ? 'added ' : 'removed ') + item.name);
	if (added) {
		if(item.name.indexOf("Metal") >= 0) {
			if(theMode == null) {
				setMode("sell");
				myLog.warning('They want ' + config.bot.item);
			}
		} else if(theMode == null && item.name == config.bot.item) {
			setMode("buy");
		} else if(item.name.indexOf("Metal") >= 0 && item.name == config.bot.item) {
			trade.chatMsg("I only accept metal or " + config.bot.item + "(s)");
			myLog.warning("Added unsupported item");
		}

		if(theMode == "sell") {
			// TODO: make sure I have enough items
			toggleMetal(item.name, "add");
			if(addedScrap < getSaleScrapRequired()) {
				myLog.warning("Not enough yet: " + getSaleScrapRequired());
			}
			else {
				var newItem = [];
				myLog.warning("BOOM - got enough");
				if(tradeItems.length > 0) {
					newItem.push(tradeItems[addedItem.length]);
					addedItem.push(newItem[newItem.length - 1]);
					trade.addItems(newItem);
				}
			}
		} else if(theMode == "buy") {
			theyAdded.push(item);
			// TODO: make sure I have enough metal
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
		} else if(theMode == "donate") {
			// do nothing
		} else if(theMode == "give") {
			// do nothing
		}
	} else if (!added) {
		if(theMode == "buy") {
			theyAdded.pop();
			if(addedScrap >= getPurchaseScrapRequired()) {
				var countToBeRemoved = getPurchaseScrapRequired();
				var toBeRemoved = [];
				while(countToBeRemoved > 0) {
					if(countToBeRemoved >= 9 && refinedAdded.length > 0) {
						toBeRemoved.push(toggleMetal("Refined Metal", "remove"));
						countToBeRemoved -= 9;
					} else if(countToBeRemoved >= 3 && reclaimedAdded.length > 0) {
						toBeRemoved.push(toggleMetal("Reclaimed Metal", "remove"));
						countToBeRemoved -= 3;
					} else if(countToBeRemoved > 0 && scrapAdded.length > 0) {
						toBeRemoved.push(toggleMetal("Scrap Metal", "remove"));
						countToBeRemoved -= 1;
					}
				}
				trade.removeItems(toBeRemoved);
			}
		}
	}
});

function getSaleScrapRequired() {
	// multiply by nine and round up
	return getScrapRequired(config.bot.sale_price);
}

function getPurchaseScrapRequired() {
	// multiply by nine and round up
	var multiplier = theyAdded.length > 0 ? theyAdded.length : 1;
	return getScrapRequired(config.bot.purchase_price) * multiplier;
}

function getScrapRequired(val) {
	return Math.ceil(val * 9);
}

function toggleMetal(name, action) {
	var itemToAdd;
	var tradeMetal;
	var tradeMetalAdded;
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
			itemToAdd = tradeMetal.pop();
			tradeMetalAdded.push(itemToAdd);
			addedItem.push(itemToAdd);
			return itemToAdd;
		}
	} else {
		myLog.warning("Removing "+name);
		addedScrap -= value;
		if(theMode == "buy") {
			var removeItem = tradeMetalAdded.pop();
			addedItem.splice(addedItem.indexOf(removeItem), 1);
			tradeMetal.push(removeItem);
			return removeItem;
		}
	}
	// reset the mode if all scrap is removed
	if(theMode == "buy" && addedScrap == 0) {
		setMode(null);
	}
	console.log(theMode);
}

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
});

trade.on('ready', function() {
  myLog.warning('Readying');
  trade.ready(function() {
  	if(validateTrade()) {
		myLog.warning('Confirming');
    	trade.confirm();
    	//trade.cancel();
  	} else {
  		myLog.error('Something went wrong with the trade, canceling');
  		trade.cancel();
  	}
  });
});

function validateTrade() {
	myLog.warning('Validating trade');

	if(theMode == "sell") {
		if(getCounts(trade.themAssets) < addedItem.length * config.bot.sale_price) {
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

	/*myLog.info("ITEMS: " + addedItemCount.length);
	myLog.info("METAL: " + addedMetalCount);
	myLog.info("SCRAP: " + addedScrapCount.length);
	myLog.info("RECLAIMED: " + addedReclaimedCount.length);
	myLog.info("REFINED: " + addedRefinedCount.length);*/

	return addedMetalCount;
}

function setMode(mode) {
	theMode = mode;
	myLog.info("MODE CHANGED TO \""+theMode+"\"");
}

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