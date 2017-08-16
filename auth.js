#! /usr/bin/node --use_strict

var fs = require('fs');
var readline   = require('readline');
var SteamTotp = require('steam-totp');

var args = process.argv.splice(2);

var username;

if(args[0]) {
	username = args[0];
} else if(process.env.STEAMBOT_USERNAME) {
	username = process.env.STEAMBOT_USERNAME;
} else {
	throw Error("MISTAKE: no username provided");
}

var accountConfigFile = __dirname + "/configs/" + username + ".json";

var account_config;

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

if(account_config.steam_guard != undefined && account_config.steam_guard.shared_secret != undefined && account_config.steam_guard.shared_secret != '') {
	var code = SteamTotp.generateAuthCode(account_config.steam_guard.shared_secret);
	console.log(code);
} else {
	var SteamUser = require('steam-user');
	var client = new SteamUser();

	client.logOn({
		"accountName": account_config.username,
		"password": account_config.password
	});

	client.on('loggedOn', function(details) {
		console.log("Logged into Steam as " + client.steamID.getSteam3RenderedID());
		
		/*client.getSteamGuardDetails(function(enabled, enabledTime, machineTime, canTrade) {
			console.log(enabled);
			console.log(enabledTime);
			console.log(machineTime);
			console.log(canTrade);
		});*/

		client.enableTwoFactor(function(response) {
			console.log(JSON.stringify(response));
			if(response.status == 1) {
				if(rl == undefined) {
					var rl = readline.createInterface({
						input: process.stdin,
						output: process.stdout
					});
				}
				rl.question('Steam Guard Code SMS: ', function(activationCode) {
					client.finalizeTwoFactor(response.shared_secret, activationCode, function() {
						console.log("DONE");
						process.exit();
					});
				});
			} else {
				console.log("Invalid response - try again later");
				process.exit(1);
			}
		});
	});
}
