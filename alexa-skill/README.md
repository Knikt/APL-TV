# APL TV skill for Alexa

> « Alexa, demande à APL TV de chercher les films Dragon Ball »
> "Alexa, ask APL TV to search Dragon Ball movies"

APL TV, open on your screen, shows the results straight away: the words typed in, the movies first, the focus on the first result.

## Why a skill

Samsung's built-in Alexa passes playback commands to APL TV (pause, play, skip, next episode: no skill needed), but it sends every search to Samsung's own search panel, which only lists Samsung's partner apps. This small skill takes the words you say and hands them to APL TV instead.

## How it works

1. You speak. Alexa understands the words and runs this skill (hosted for free by Amazon in your own developer account; only your Amazon account can use it).
2. The skill posts the words to a private [ntfy.sh](https://ntfy.sh) topic: the code shown in APL TV › Settings › Alexa Skill. Nothing else goes through it, and ntfy.sh is told not to keep it (`Cache: no`).
3. APL TV listens to that topic while it is open on the screen, and runs the search. A message can only ever be a search.

Keep the code to yourself: anyone who has it can start a search on your screen (nothing more). Settings › Alexa Skill › New Code changes it.

## Set it up (about 10 minutes)

1. In APL TV: Settings › Alexa Skill › Turn On. Note the code (`apltv-…`).
2. Sign in to the [Alexa developer console](https://developer.amazon.com/alexa/console/ask) with the Amazon account your screen's Alexa uses (create a free developer account if asked).
3. **Create Skill**: name `APL TV`, primary locale **French (FR)** (or the language your Alexa speaks), type **Other** › **Custom**, hosting **Alexa-hosted (Node.js)**, template **Start from Scratch**. Wait for it to be created.
4. **Build** › **Interaction Model** › **JSON Editor**: paste the content of `skill-package/interactionModels/custom/fr-FR.json` (or `en-US.json`), **Save**, then **Build skill**.
5. **Code**: open `lambda/index.js`, replace everything with this folder's `lambda/index.js`, put your code in `const CODE = '…'`, **Save**, then **Deploy**.
6. **Test**: switch "Skill testing is enabled in" to **Development**. Type `demande à a. p. l. t. v. de chercher dragon ball`: APL TV, open on the screen, should show the results.
7. On the screen: open APL TV, then say « Alexa, demande à APL TV de chercher les films Dragon Ball ».

The invocation name is `a. p. l. t. v.` (Alexa wants letters spelled out like that). If Alexa does not understand it, change it in **Invocation** to something easier to say, such as `mon a. p. l.`, then **Build skill** again.

### Or from the command line (ASK CLI)

With Amazon's [ASK CLI](https://github.com/alexa/ask-cli) (`npm install -g ask-cli`; in Windows PowerShell, call it `ask.cmd`):

1. `ask configure`: sign in with your Amazon account in the browser, answer **No** to linking an AWS account.
2. Create the skill, hosted by Amazon: `ask smapi create-skill-for-vendor --manifest file:create.json`, where `create.json` holds `vendorId`, a `manifest` (name in `publishingInformation.locales.fr-FR`, `"apis": {"custom": {}}`) and `"hosting": {"alexaHosted": {"runtime": "NODE_16_X", "region": "EU_WEST_1"}}`. Wait until `ask smapi get-skill-status -s <skillId>` shows `hostedSkillProvisioning` SUCCEEDED.
3. The code: `ask smapi get-alexa-hosted-skill-metadata -s <skillId>` gives the git repository; get credentials with `ask smapi generate-credentials-for-alexa-hosted-skill`, clone it, replace `lambda/index.js` (with your code in it), commit and push to `master`: Amazon deploys it.
4. The model: `ask smapi set-interaction-model -s <skillId> -g development -l fr-FR --interaction-model file:skill-package/interactionModels/custom/fr-FR.json`.
5. Testing: `ask smapi set-skill-enablement -s <skillId> -g development`, then try it with `ask smapi simulate-skill -s <skillId> -g development --device-locale fr-FR --input-content "demande à a. p. l. t. v. de chercher dragon ball"`.

## What you can say

| Français | English |
|---|---|
| Alexa, demande à APL TV de chercher les films Dragon Ball | Alexa, ask APL TV to search for Dragon Ball movies |
| Alexa, demande à APL TV de trouver la série One Piece | Alexa, ask APL TV to find the series One Piece |
| Alexa, demande à APL TV de mettre M6 (the channel starts) | Alexa, ask APL TV to put on BBC One (the channel starts) |
| Alexa, demande à APL TV de mettre les chaînes de sport | Alexa, ask APL TV to show me sports channels |
| Alexa, ouvre APL TV (puis : cherche Shrek) | Alexa, open APL TV (then: search Shrek) |

A channel named exactly starts straight away (your favorite or recent one first, then one in your language, then the best quality). Otherwise the search opens; "films", "séries", "chaînes" (movies, series, channels) put that row first.
Channel names said aloud are understood too: « M6 », « TF1 », « France 2 », « Canal+ » (Alexa writes them "m. six", "t. f. un"…).

## Files

- `skill-package/interactionModels/custom/fr-FR.json`, `en-US.json`: what the skill understands.
- `lambda/index.js`: the skill (Node.js, `ask-sdk-core`); `lambda/package.json` if you deploy it yourself (ASK CLI or AWS Lambda).
