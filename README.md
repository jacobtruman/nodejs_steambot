# Steambot for Node.js
[![npm version](https://img.shields.io/npm/v/nodejs_steambot.svg)](https://npmjs.com/package/nodejs_steambot)
[![npm downloads](https://img.shields.io/npm/dm/nodejs_steambot.svg)](https://npmjs.com/package/nodejs_steambot)
[![dependencies](https://img.shields.io/david/jacobtruman/nodejs_steambot.svg)](https://david-dm.org/jacobtruman/nodejs_steambot)

Install it from [npm](https://www.npmjs.com/package/nodejs_steambot) or check out the [wiki](https://github.com/jacobtruman/nodejs_steambot/wiki) for documentation.

# Support

Report bugs on the [issue tracker](https://github.com/jacobtruman/nodejs_steambot/issues).

If you need help extracting your steam file, contact [LeeTheGayKid](http://www.steamcommunity.com/id/jingyong) <b>You will need your phone to be rooted !</b>

# Installation

This will guide users on how to install the bot

1. Download and extract the bot to somewhere easy to access. E.g Desktop
2. Run cmd and cd to the file  E.g (my bot's file is named bot) `cd desktop` then, `cd bot`
3. Do `npm install`
4. After it is done, make a subfolder named `configs`
5. Copy `sample_userconfig.json` into the `configs` folder
6. Make 2 copies of that and renaming 1 of them to `config.json` and another to `username.json` >*username.json can be renamed to anything*
7. Fill in all the needed stuff in `username.json` except for `login_key` it's auto generated  *You have the extract the steam file from your phone or any device you used to enable steam guard. Read support if you don't know how to extract your steam file*

# Running the bot

This will guide you on how to run the bot

1. Run cmd and cd to the file  E.g (my bot's file is named bot) `cd desktop` then, `cd bot`
2. Type `node index.js <username>` *The username is the name of `username.json`
