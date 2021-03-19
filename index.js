import template from "./template.handlebars";

function sleep(msecs) {
    if (msecs == 0) {
        return Promise.resolve();
    }
    return new Promise(function(resolve) {
        setTimeout(resolve, msecs);
    });
}

async function sendEsiRequest(url, opts) {
    for (const backoff of [0, 10, 160, 810, 2560, 6250, 10000, 10000, 10000]) {
        await sleep(backoff);
        const response = await fetch(url, opts);
        if (!response.ok) {
            continue;
        }
        const bodyData = await response.json();
        return {headers: response.headers, data: bodyData};
    }
    throw 'Retry count exceeded';
}


async function getAllPages(urlGenerator, opts) {
    const first = await sendEsiRequest(urlGenerator(1), opts);
    const pages = Number(first.headers.get('X-Pages'));
    if (pages == 1) {
        return first.data;
    }
    const pagePromises = [];
    for (let i = 2; i <= pages; i++) {
        pagePromises.push(sendEsiRequest(urlGenerator(i), opts));
    }
    const pageResps = await Promise.all(pagePromises);
    for (let i = 0; i < pageResps.length; i++) {
        pageResps[i] = pageResps[i].data;
    }
    return first.data.concat(...pageResps);
}

function urlencodedStringify(obj) {
    const parts = [];
    for (const key of Object.keys(obj)) {
        parts.push(key + '=' + encodeURIComponent(obj[key]));
    }
    return parts.join('&');
}

async function makeAuthenticator(clientId, refreshToken) {
    const response = await fetch('https://login.eveonline.com/v2/oauth/token', {
        method: 'POST',
        body: urlencodedStringify({
            "grant_type": "refresh_token",
            "client_id": clientId,
            "refresh_token": refreshToken
        }),
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    });
    if (!response.ok) {
        throw 'SSO error';
    }
    const body = await response.json();
    return function(opts) {
        if (!('headers' in opts)) {
            opts.headers = {};
        }
        opts.headers.Authorization = 'Bearer ' + body.access_token;
        return opts;
    };
}

function getCharacterContractsAll(characterId, authenticator) {
    const urlGenerator = function(page) {
        return 'https://esi.evetech.net/v1/characters/' + characterId + '/contracts/?page=' + page;
    };
    return getAllPages(urlGenerator, authenticator({}));
}

const CLIENT_ID = '165c4ad849f5432a9aa3d13ffbfc57dd';


async function makeTemplateArgs(clientId, characterId, refreshToken) {
    const authenticator = await makeAuthenticator(CLIENT_ID, refreshToken);
    const contracts = await getCharacterContractsAll(characterId, authenticator);

    let oldest = null;
    let numContracts = 0;
    let teams = 0;
    let serps = 0;
    let agents = 0;
    let unknown = 0;
    let teamsISK = 0;
    let serpsISK = 0;
    let agentsISK = 0;
    let unknownISK = 0;

    const now = new Date();
    for (const contract of contracts) {
        if (contract.status != 'outstanding') {
            continue;
        }
        if (contract.type != 'item_exchange') {
            continue;
        }
        if (contract.assignee_id != characterId) {
            continue;
        }
        if (new Date(contract.date_expired) < now) {
            continue;
        }
        const issuedAt = new Date(contract.date_issued);
        if (oldest === null || oldest > issuedAt) {
            oldest = issuedAt;
        }
        numContracts++;
        if (!('title' in contract)) {
            continue;
        }
        const normTitle = contract.title.toLowerCase();
        if (normTitle.includes('team')) {
            teamsISK += Math.floor(contract.reward / 1000000);
            teams += Math.floor(contract.reward / 25000000);
        } else if (normTitle.includes('serp')) {
            serpsISK += Math.floor(contract.reward / 1000000);
            serps += Math.floor(contract.reward / 25000000);
        } else if (normTitle.includes('angel') || normTitle.includes('sansha')) {
            agentsISK += Math.floor(contract.reward / 1000000);
            agents += Math.floor(contract.reward / 25000000);
        } else {
            unknownISK += Math.floor(contract.reward / 1000000);
            unknown += Math.floor(contract.reward / 25000000);
        }
    }
    return {oldest, numContracts, teams, serps, agents, unknown, teamsISK, serpsISK, agentsISK, unknownISK};
}

async function handleRequest(request) {
    const domain = new URL(request.url).hostname.split('.')[0];
    const templateArgs = await AFSTATUS_KV.get(domain, 'json');
    const diff = Math.floor((new Date() - new Date(templateArgs.oldest)) / 60000);
    templateArgs.minutes = diff % 60;
    templateArgs.hours = Math.floor(diff / 60) % 24;
    templateArgs.days = Math.floor(diff / 1440);
    return new Response(template(templateArgs), {
        headers: {
            "content-type": "text/html;charset=UTF-8"
        }
    });
}

async function updateSite(clientId, site) {
    const data = await makeTemplateArgs(clientId, site.characterId, site.refreshToken);
    await AFSTATUS_KV.put(site.url, JSON.stringify(data));
}

async function handleScheduled() {
    const config = await AFSTATUS_KV.get("_Zconfig", "json");
    const promises = [];
    for (const site of config.sites) {
        promises.push(updateSite(config.clientId, site));
    }
    await Promise.all(promises);
}

addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request));
});

addEventListener("scheduled", event => {
    event.waitUntil(handleScheduled());
});
