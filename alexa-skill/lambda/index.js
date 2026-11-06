/* APL TV skill for Alexa.
   "Alexa, ask APL TV to search Dragon Ball movies" / « Alexa, demande à APL TV de chercher les films Dragon Ball »
   APL TV, open on your screen, shows the results straight away.

   Samsung's Alexa sends every search to Samsung's own panel, so this skill takes the words and hands them to
   APL TV through a private ntfy.sh topic: the code shown in APL TV › Settings › Alexa Skill. Only the words
   searched go through it (not stored by ntfy.sh: "Cache: no"). Put your code below, then Save and Deploy.
   Setup: alexa-skill/README.md. */
const Alexa = require('ask-sdk-core');
const https = require('https');

const CODE = 'PUT-THE-CODE-FROM-APL-TV-HERE';

const isFrench = (h) => String(Alexa.getLocale(h.requestEnvelope) || '').indexOf('fr') === 0;
const t = (h, fr, en) => (isFrench(h) ? fr : en);
const ssml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const codeSet = () => /^[A-Za-z0-9_-]{12,64}$/.test(CODE);

/* The words, to APL TV. Resolves true when ntfy.sh took them. */
function send(q) {
    return new Promise((resolve) => {
        const body = JSON.stringify({ q: q, at: Date.now() });
        const req = https.request({
            host: 'ntfy.sh', path: '/' + CODE, method: 'POST', timeout: 4000,
            headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache': 'no', 'Firebase': 'no' }
        }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode >= 200 && res.statusCode < 300)); });
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', () => resolve(false));
        req.end(body);
    });
}

const LaunchRequestHandler = {
    canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === 'LaunchRequest',
    handle: (h) => h.responseBuilder
        .speak(t(h, 'Que veux-tu chercher sur APL TV ? Dis par exemple : cherche les films Dragon Ball.',
                    'What should APL TV search for? For example: search Dragon Ball movies.'))
        .reprompt(t(h, 'Dis par exemple : cherche Dragon Ball.', 'For example: search Dragon Ball.'))
        .getResponse()
};

const SearchIntentHandler = {
    canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(h.requestEnvelope) === 'SearchIntent',
    async handle(h) {
        const q = String(Alexa.getSlotValue(h.requestEnvelope, 'query') || '').trim().slice(0, 80);
        if (!q) {
            return h.responseBuilder.speak(t(h, 'Que veux-tu chercher ?', 'What should I search for?'))
                .reprompt(t(h, 'Dis par exemple : cherche Dragon Ball.', 'For example: search Dragon Ball.')).getResponse();
        }
        if (!codeSet()) {
            return h.responseBuilder.speak(t(h, "Il manque le code d'APL TV dans la skill. Tu le trouves dans APL TV, Réglages, Skill Alexa.",
                                                "The skill does not have APL TV's code yet. It is in APL TV, Settings, Alexa Skill.")).getResponse();
        }
        const ok = await send(q);
        return h.responseBuilder.speak(ok
            ? t(h, 'Je cherche ' + ssml(q) + ' sur APL TV.', 'Searching APL TV for ' + ssml(q) + '.')
            : t(h, "Je n'arrive pas à joindre APL TV. Réessaie dans un instant.", "I can't reach APL TV right now. Try again in a moment.")
        ).withShouldEndSession(true).getResponse();
    }
};

const HelpIntentHandler = {
    canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(h.requestEnvelope) === 'AMAZON.HelpIntent',
    handle: (h) => h.responseBuilder
        .speak(t(h, "Ouvre APL TV sur l'écran, puis dis par exemple : demande à APL TV de chercher les films Dragon Ball.",
                    'Open APL TV on your screen, then say for example: ask APL TV to search Dragon Ball movies.'))
        .reprompt(t(h, 'Que veux-tu chercher ?', 'What should I search for?'))
        .getResponse()
};

const StopHandler = {
    canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest'
        && ['AMAZON.CancelIntent', 'AMAZON.StopIntent', 'AMAZON.NavigateHomeIntent'].indexOf(Alexa.getIntentName(h.requestEnvelope)) !== -1,
    handle: (h) => h.responseBuilder.speak(t(h, "D'accord.", 'Okay.')).withShouldEndSession(true).getResponse()
};

const FallbackHandler = {
    canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(h.requestEnvelope) === 'AMAZON.FallbackIntent',
    handle: (h) => h.responseBuilder
        .speak(t(h, "Je n'ai pas compris. Dis par exemple : cherche Dragon Ball.", "I didn't get that. For example: search Dragon Ball."))
        .reprompt(t(h, 'Que veux-tu chercher ?', 'What should I search for?'))
        .getResponse()
};

const SessionEndedHandler = {
    canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === 'SessionEndedRequest',
    handle: (h) => h.responseBuilder.getResponse()
};

const ErrorHandler = {
    canHandle: () => true,
    handle: (h, error) => {
        console.log('APL TV skill error: ' + (error && error.message));
        return h.responseBuilder.speak(t(h, "Désolé, ça n'a pas marché.", "Sorry, that didn't work.")).withShouldEndSession(true).getResponse();
    }
};

exports.handler = Alexa.SkillBuilders.custom()
    .addRequestHandlers(LaunchRequestHandler, SearchIntentHandler, HelpIntentHandler, StopHandler, FallbackHandler, SessionEndedHandler)
    .addErrorHandlers(ErrorHandler)
    .lambda();
exports.send = send;   // for tests
