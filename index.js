#! /usr/bin/env node

// requires
var fs = require('fs');
var SteamID = require('steamid');
var SteamUser = require('steam-user');
var SteamTotp = require('steam-totp');
var SteamCommunity = require('steamcommunity');
var TradeOfferManager = require('steam-tradeoffer-manager');

// cli paramters
var args = process.argv.splice(2);

var client = new SteamUser();
var community = new SteamCommunity();

// config files
var configFile = __dirname + "/configs/config.json";
var accountConfigFile = __dirname + "/configs/" + args[0] + ".json";

var dataDirectory = __dirname + "/data";
var admin_usernames = [];
var admin_ids = [];

var my_steamid;

// main config
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

// account config
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

// make sure there is a password defined
if (account_config.password == undefined) {
	throw new Error("Please specify password");
}

if (config.admin_accounts) {
	var sid;
	for (account in config.admin_accounts) {
		admin_usernames.push(account);
		if(config.admin_accounts[account].id != undefined) {
			sid = new SteamID(config.admin_accounts[account].id);
			admin_ids.push(sid);
		}
	}
}

function isAdminSteamID(sid) {
	sid = JSON.stringify(sid);
	for(obj in admin_ids) {
		if(sid == JSON.stringify(admin_ids[obj])) {
			return true;
		}
	}
	return false;
}

var manager = new TradeOfferManager({
	"steam": client,
	"domain": "trucraft.net",
	"language": "en"
});

if(fs.existsSync('polldata.json')) {
	manager.pollData = JSON.parse(fs.readFileSync('polldata.json'));
}

var logOnOptions = {
	"accountName": account_config.username
};

if(account_config.login_key != undefined) {
	logOnOptions.loginKey = account_config.login_key;
} else {
	if(account_config.password != undefined) {
		logOnOptions.password = account_config.password;
		logOnOptions.rememberPassword = true;
	}
}

if(account_config.steam_guard.shared_secret != undefined) {
	logOnOptions.twoFactorCode = SteamTotp.generateAuthCode(account_config.steam_guard.shared_secret);
}

/**
 * steam-user client methods BEGIN
 */

client.setOptions({"dataDirectory": dataDirectory});

client.logOn(logOnOptions);

client.on('loggedOn', function(details) {
	my_steamid = client.steamID;
	console.log("Logged into Steam as " + client.steamID.getSteam3RenderedID());
	client.setPersona(SteamUser.Steam.EPersonaState.Online);
	//client.gamesPlayed(440);
	client.getSteamGuardDetails(function(enabled, enabledTime, machineTime, canTrade) {
		console.log(enabled);
		console.log(enabledTime);
		console.log(machineTime);
		console.log(canTrade);
	});
});

client.on('error', function(e) {
	// Some error occurred during logon
	console.log("Undefined error: "+e);
});

client.on('webSession', function(sessionID, cookies) {
	manager.setCookies(cookies, function(err) {
		if(err) {
			console.log(err);
			process.exit(1); // Fatal error since we couldn't get API key
		}

		console.log("Got API key: " + manager.apiKey);
	});
});

client.on('newItems', function(count) {
	console.log(count + " new items in this account's inventory");
});

client.on('emailInfo', function(address, validated) {
	console.log("The email address of this account is " + address + " and it's " + (validated ? "validated" : "not validated"));
});

client.on('wallet', function(hasWallet, currency, balance) {
	console.log("This account's wallet balance is " + SteamUser.formatCurrency(balance, currency));
});

client.on('accountLimitations', function(limited, communityBanned, locked, canInviteFriends) {
	var limitations = [];

	if(limited) {
		limitations.push('LIMITED');
	}

	if(communityBanned) {
		limitations.push('COMMUNITY BANNED');
	}

	if(locked) {
		limitations.push('LOCKED');
	}

	if(limitations.length === 0) {
		console.log("This account has no limitations.");
	} else {
		console.log("This account is " + limitations.join(', ') + ".");
	}

	if(canInviteFriends) {
		console.log("This account can invite friends.");
	}
});

client.on('vacBans', function(numBans, appids) {
	console.log("This account has " + numBans + " VAC ban" + (numBans == 1 ? '' : 's') + ".");
	if(appids.length > 0) {
		console.log("This account is VAC banned from apps: " + appids.join(', '));
	}
});

client.on('licenses', function(licenses) {
	console.log("This account owns " + licenses.length + " license" + (licenses.length == 1 ? '' : 's') + ".");
});

client.on('loginKey', function(loginKey) {
	console.log("New Login Key: "+loginKey);
});

client.on("sentry", function(sentry) {
	console.log(sentry);
});
/**
 * steam-user client methods END
 */

/**
 * steam-tradeoffer-manager methods BEGIN
 */
manager.on('newOffer', function(offer) {
	console.log("New offer #" + offer.id + " from " + offer.partner.getSteam3RenderedID());
	processOffer(offer, function(passed) {
		if(passed) {
			community.checkConfirmations();
		}
	});
});

manager.on('receivedOfferChanged', function(offer, oldState) {
	console.log("Offer #" + offer.id + " changed: " + TradeOfferManager.getStateName(oldState) + " -> " + TradeOfferManager.getStateName(offer.state));

	if(offer.state == TradeOfferManager.ETradeOfferState.Accepted) {
		offer.getReceivedItems(function(err, items) {
			if(err) {
				console.log("Couldn't get received items: " + err);
			} else {
				if (items.length > 0) {
					var names = items.map(function (item) {
						return item.name;
					});

					console.log("Received: " + names.join(', '));
				}
			}
		});
	}
});
/**
 * steam-tradeoffer-manager methods END
 */

var login_details = {
	"accountName": account_config.username,
	"password": account_config.password,
	"twoFactorCode": SteamTotp.generateAuthCode(account_config.steam_guard.shared_secret)
};

community.loggedIn(function(err, loggedIn) {
	if(err != null) {
		console.log(err);
		process.exit(1);
	}
	if(loggedIn) {
		console.log("Logged into community");
	} else {
		community.login(login_details, function (err) {
			console.log("Logging into community");
			if (err != null) {
				console.log("Failed to login to community: "+err);
				process.exit(1);
			}

			console.log("Starting comfirmation polling");
			community.startConfirmationChecker(10000, account_config.steam_guard.identity_secret);
			console.log("Checking confirmations");
			community.checkConfirmations();
		});
	}
});

community.on("newConfirmation", function(confirmation) {
	console.log("New confirmation");
	processConfirmation(confirmation, function(passed) {
		console.log(passed);
	});
});

community.on("confKeyNeeded", function(tag, callback) {
	console.log("Confirmation key needed");
	var time = Math.floor(Date.now() / 1000);
	console.log(callback.toString());
	callback(null, time, SteamTotp.getConfirmationKey(account_config.steam_guard.identity_secret, time, tag));
});

function processConfirmation(confirmation, callback) {
	var time = Math.floor(Date.now() / 1000);
	var key = SteamTotp.getConfirmationKey(account_config.steam_guard.identity_secret, time, "conf");
	community.respondToConfirmation(confirmation.id, confirmation.key, time, key, true, function (err) {
		console.log("Responding to confirmation "+confirmation.id);
		var ret = true;
		if (err != null) {
			console.log(err);
			ret = false;
			console.log("Responding to confirmation "+confirmation.id+" failed");
		} else {
			console.log("Responding to confirmation "+confirmation.id+" succeeded");
		}

		if (typeof(callback) == "function") {
			callback(ret);
		}
	});
}

function processOfferByID(id, callback) {
	console.log("Process offer by id "+id);
	getOffer(id, function(err, offer) {
		if(err != null) {
			console.log(err);
			if (typeof(callback) == "function") {
				callback(false);
			}
		} else {
			processOffer(offer, callback);
		}
	});
}

function processOffer(offer, callback) {
	console.log("Process offer");
	if(isAdminSteamID(offer.partner)) {
		console.log("## Admin offer");
		offer.accept(function (err) {
			var ret = true;
			if (err) {
				console.log("Unable to accept offer: " + err.message);
				//client.webLogOn();
				//processOffer(offer, callback);
				ret = false;
			} else {
				console.log("Offer accepted");
			}

			if (typeof(callback) == "function") {
				callback(ret);
			}
		});
	} else {
		console.log("## Not an admin");
		if (typeof(callback) == "function") {
			callback(false);
		}
	}
}


function showMethods(obj) {
	console.log("\nMETHODS\n");
	for(var m in obj) {
		if(typeof obj[m] == "function") {
			console.log(m);
		}
	}
}

function showMembers(obj) {
	console.log("\nMEMBERS\n");
	for(var m in obj) {
		if(typeof obj[m] != "function") {
			console.log(m);
		}
	}
}