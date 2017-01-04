#! /usr/bin/env node

// requires
var fs = require('fs');
var logger = require('tru-logger');
var mkdirp = require('mkdirp');
var SteamID = require('steamid');
var SteamUser = require('steam-user');
var SteamTotp = require('steam-totp');
var SteamCommunity = require('steamcommunity');
var TradeOfferManager = require('steam-tradeoffer-manager');

// cli paramters
var args = process.argv.splice(2);

var username = args[0];

var client = new SteamUser();
var community = new SteamCommunity();

// config files
var configsDir = __dirname + "/configs";
var configFile = configsDir + "/config.json";
var accountConfigFile = configsDir + "/" + username + ".json";

// variables
var logDir = __dirname + "/logs/";
mkdirp(logDir, function(err) {
	// path was created unless there was error
});

var dataDirectory = __dirname + "/data";
var admin_usernames = [];
var admin_ids = [];
var admins = {};

var my_steamid;
var lastTwoFactorCode = null;

var config = [];
var account_config = [];

// number of seconds to wait between login attempts
var loginSleepTime = 10;

// main config
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

// account config
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

// make sure there is a password defined
if(account_config.password == undefined) {
	throw new Error("Please specify password");
}

// initialize log
var logOptions = {
	file: logDir + account_config.username + ".txt",
	date: true,
	print: true,
	//log_level: ["success", "error"],
	log_level: ["all"],
	prefix: account_config.username
};

var myLog = new logger(logOptions);

if(config.admin_accounts) {
	var sid;
	for(account in config.admin_accounts) {
		admin_usernames.push(account);
		if(config.admin_accounts[account].id != undefined) {
			sid = new SteamID(config.admin_accounts[account].id);
			admins[config.admin_accounts[account].id] = account;
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

var logOnOptions = getLogonOptions();

/**
 * steam-user client methods BEGIN
 */

client.setOptions({"dataDirectory": dataDirectory});

client.logOn(logOnOptions);

client.on('loggedOn', function(details) {
	my_steamid = client.steamID;
	myLog.success("Logged into Steam as " + client.steamID.getSteam3RenderedID());
	client.setPersona(SteamUser.Steam.EPersonaState.Online);
	//client.gamesPlayed(440);
	client.getSteamGuardDetails(function(enabled, enabledTime, machineTime, canTrade) {
		/*myLog.info(enabled);
		 myLog.info(enabledTime);
		 myLog.info(machineTime);
		 myLog.info(canTrade);*/
	});
});

client.on('error', function(e) {
	if(e = "Error: InvalidPassword") {
		account_config.login_key = undefined;
		// write new login key to config file
		client.logOff();
		var logOnOptions = getLogonOptions();
		client.logOn(logOnOptions);
	}
	// Some error occurred during logon
	myLog.error("Undefined error: " + e);
});

client.on('webSession', function(sessionID, cookies) {
	manager.setCookies(cookies, function(err) {
		if(err) {
			myLog.error(err);
			process.exit(1); // Fatal error since we couldn't get API key
		}

		myLog.success("Got API key: " + manager.apiKey);
	});
});

client.on('newItems', function(count) {
	myLog.success(count + " new items in this account's inventory");
});

client.on('emailInfo', function(address, validated) {
	myLog.info("The email address of this account is " + address + " and it's " + (validated ? "validated" : "not validated"));
});

client.on('wallet', function(hasWallet, currency, balance) {
	myLog.info("This account's wallet balance is " + SteamUser.formatCurrency(balance, currency));
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
		myLog.info("This account has no limitations.");
	} else {
		myLog.warning("This account is " + limitations.join(', ') + ".");
	}

	if(canInviteFriends) {
		myLog.info("This account can invite friends.");
	}
});

client.on('vacBans', function(numBans, appids) {
	myLog.warning("This account has " + numBans + " VAC ban" + (numBans == 1 ? '' : 's') + ".");
	if(appids.length > 0) {
		myLog.error("This account is VAC banned from apps: " + appids.join(', '));
	}
});

client.on('licenses', function(licenses) {
	myLog.chat("This account owns " + licenses.length + " license" + (licenses.length == 1 ? '' : 's') + ".");
});

client.on('loginKey', function(loginKey) {
	myLog.info("New Login Key: " + loginKey);
	account_config.login_key = loginKey;
	// write new login key to config file
	fs.writeFile(accountConfigFile, JSON.stringify(account_config, null, "\t"), function(err) {
		if(err) {
			myLog.error(err);
		}
		myLog.info("The config file \"" + accountConfigFile + "\" was saved");
	});
});

client.on("sentry", function(sentry) {
	myLog.attention(sentry);
});
/**
 * steam-user client methods END
 */

/**
 * steam-tradeoffer-manager methods BEGIN
 */
manager.on('newOffer', function(offer) {
	myLog.warning("New offer #" + offer.id + " from " + offer.partner.getSteam3RenderedID());
	processOffer(offer, function(passed) {
		if(passed) {
			community.checkConfirmations();
		}
	});
});

manager.on('receivedOfferChanged', function(offer, oldState) {
	myLog.info("Offer #" + offer.id + " changed: " + TradeOfferManager.ETradeOfferState[oldState] + " -> " + TradeOfferManager.ETradeOfferState[offer.state]);

	if(offer.state == TradeOfferManager.ETradeOfferState.Accepted) {
		offer.getReceivedItems(function(err, items) {
			if(err) {
				myLog.error("Couldn't get received items: " + err);
			} else {
				if(items.length > 0) {
					var names = items.map(function(item) {
						return item.name;
					});

					myLog.success("Received: " + names.join(', '));
				}
			}
		});
	}
});
/**
 * steam-tradeoffer-manager methods END
 */

var login_details;

getLoginDetails();

function getLoginDetails() {
	login_details = {
		"accountName": account_config.username,
		"password": account_config.password,
		"twoFactorCode": SteamTotp.generateAuthCode(account_config.steam_guard.shared_secret)
	};
}

community.loggedIn(function(err, loggedIn) {
	if(err != null) {
		myLog.error(err);
		process.exit(1);
	}
	if(loggedIn) {
		myLog.success("Already logged into community");
	} else {
		community_login(function() {
			myLog.info("Starting comfirmation polling");
			community.startConfirmationChecker(10000, account_config.steam_guard.identity_secret);
			myLog.info("Checking confirmations");
			community.checkConfirmations();
		});
	}
});

function community_login(callback) {
	if(lastTwoFactorCode != login_details.twoFactorCode) {
		lastTwoFactorCode = login_details.twoFactorCode;
		community.login(login_details, function(err) {
			myLog.info("Logging into community");
			if(err != null) {
				myLog.error("Failed to login to community: " + err);
				community_login(callback);
			} else {
				myLog.success("Successfully logged into community");
				if(typeof(callback) == "function") {
					callback();
				}
			}
		});
	} else {
		myLog.warning("SteamGuard code has not changed yet: " + lastTwoFactorCode + " == " + login_details.twoFactorCode);

		myLog.attention("Sleeping " + loginSleepTime + " seconds and trying again...");
		// wait for loginSleepTime seconds and try again
		getLoginDetails();
		setTimeout(function() {
			community_login(callback);
		}, 1000 * loginSleepTime);
	}
}

community.on("newConfirmation", function(confirmation) {
	myLog.attention("New confirmation");
	processConfirmation(confirmation, function(passed) {
		myLog.success(passed);
	});
});

community.on("confKeyNeeded", function(tag, callback) {
	myLog.warning("Confirmation key needed");
	var time = Math.floor(Date.now() / 1000);
	myLog.info(callback.toString());
	callback(null, time, SteamTotp.getConfirmationKey(account_config.steam_guard.identity_secret, time, tag));
});

function processConfirmation(confirmation, callback) {
	var time = Math.floor(Date.now() / 1000);
	var key = SteamTotp.getConfirmationKey(account_config.steam_guard.identity_secret, time, "conf");
	community.respondToConfirmation(confirmation.id, confirmation.key, time, key, true, function(err) {
		myLog.info("Responding to confirmation " + confirmation.id);
		var ret = true;
		if(err != null) {
			myLog.error(err);
			ret = false;
			myLog.error("Responding to confirmation " + confirmation.id + " failed");
		} else {
			myLog.success("Responding to confirmation " + confirmation.id + " succeeded");
		}

		if(typeof(callback) == "function") {
			callback(ret);
		}
	});
}

function processOfferByID(id, callback) {
	myLog.attention("Process offer by id " + id);
	getOffer(id, function(err, offer) {
		if(err != null) {
			myLog.error(err);
			if(typeof(callback) == "function") {
				callback(false);
			}
		} else {
			processOffer(offer, callback);
		}
	});
}

function processOffer(offer, callback) {
	myLog.attention("Process offer");
	if(isAdminSteamID(offer.partner)) {
		var partner_name;
		if(admins[JSON.stringify(offer.partner)] !== undefined) {
			partner_name = admins[JSON.stringify(offer.partner)];
		} else {
			partner_name = "unknown";
		}
		myLog.attention("## Admin offer from " + partner_name);
		offer.accept(function(err) {
			var ret = true;
			if(err) {
				myLog.error("Unable to accept offer from " + partner_name + ": " + err.message);
				if(err.message == "HTTP error 403") {
					// logoff and log back on
					setTimeout(function() {
						client.logOff();
					}, 1000 * loginSleepTime);
					var logOnOptions = getLogonOptions();
					setTimeout(function() {
						client.logOn(logOnOptions);
					}, 1000 * loginSleepTime);
				}
				//client.webLogOn();
				//processOffer(offer, callback);
				ret = false;
			} else {
				myLog.success("Offer from " + partner_name + " accepted");
			}

			if(typeof(callback) == "function") {
				callback(ret);
			}
		});
	} else {
		myLog.warning("## Not an admin");
		if(typeof(callback) == "function") {
			callback(false);
		}
	}
}

function getLogonOptions() {
	var options = {
		"accountName": account_config.username
	};

	if(account_config.login_key != undefined) {
		options.loginKey = account_config.login_key;
	} else {
		if(account_config.password != undefined) {
			options.password = account_config.password;
			options.rememberPassword = true;
		}
	}

	if(account_config.steam_guard.shared_secret != undefined) {
		options.twoFactorCode = SteamTotp.generateAuthCode(account_config.steam_guard.shared_secret);
	}
	//myLog.info(options);

	return options;
}


function showMethods(obj) {
	myLog.attention("\nMETHODS\n");
	for(var m in obj) {
		if(typeof obj[m] == "function") {
			myLog.chat(m);
		}
	}
}

function showMembers(obj) {
	myLog.attention("\nMEMBERS\n");
	for(var m in obj) {
		if(typeof obj[m] != "function") {
			myLog.chat(m);
		}
	}
}