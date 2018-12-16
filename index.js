// API documentation https://developers.themoviedb.org/3/getting-started/introduction

require("dotenv").config();
const commander = require('commander');
const URL = require("url").URL;
const fetch = require('node-fetch');
const columnify = require("columnify");

// define command line interface
commander
    .version("0.1.0")
    .option("-f, --file", "json file to process, defaults to ./state.json")
    .option("-a, --all", "shows without new content will be hidden without this flag")
    .parse(process.argv);

function sleep(ms) {
    return new Promise(resolve => setTimeout(() => {
        console.log("sleep resolved");
        return resolve();
    }, ms));
}

function buildUrl(path, queryParams) {
    const url = new URL(process.env.API_URL);
    url.pathname = "/" + process.env.API_VERSION + path;
    url.searchParams.append("api_key", process.env.API_KEY);
    if (queryParams) Object.keys(queryParams).forEach(key => url.searchParams.append(key, queryParams[key]));
    return url;
}

//TODO: handle rate limiting here https://developers.themoviedb.org/3/getting-started/request-rate-limiting
const concurrentRequests = 20;
const queuedRequests = [];
let pendingRequests = 0;
let backoff = null;
let i = 0;
const api = async (path, params) => {
    const n = i++;
    if (pendingRequests >= concurrentRequests) {
        console.log(n, "paused");
        await new Promise(resolve => queuedRequests.push(resolve));
        console.log(n, "resuming");
    }
    pendingRequests++;
    const url = buildUrl(path, params);
    let response;
    while (true) {
        // wait if we are rate limited
        if (backoff != null) {
            console.log(n, "back off delay");
            await backoff;
        }
        // try to fetch data
        response = await fetch(url);
        // check if we are rate limited
        if (response.status !== 429) {
            const remaining = parseInt(response.headers.get("X-RateLimit-Remaining"));
            console.log(n, "rate limit remaining", remaining);
            if (remaining < pendingRequests && backoff == null) {
                const reset = parseInt(response.headers.get("X-RateLimit-Reset"));
                const now = Date.now() / 1000 | 0;
                // add a second to make sure we don't get blocked again
                const delay = 1 + reset - now;
                console.log(n, `back off for ${delay}s`);
                backoff = sleep(delay * 1000).then(() => backoff = null);
            }
            break;
        }
        if (backoff == null) {
            // add a second to make sure we don't get blocked again
            const delay = 1 + parseInt(response.headers.get("retry-after"));
            console.warn(n, `rate limit response, back off for ${delay}s`);
            // set backoff promise which resolves after the given delay
            backoff = sleep(delay * 1000).then(() => backoff = null);
        }
    }
    console.log(n, `done, pending/queued ${pendingRequests}/${queuedRequests.length}`);
    pendingRequests--;
    if (queuedRequests.length) {
        const resolve = queuedRequests.shift();
        resolve();
    }
    return response.json();
};

const apiSeriesSearch = (query) => api("/search/tv", {query});
const apiSeriesInfo = id => api("/tv/" + id);

function formatEpisodeNumber(season, episode) {
    const s = season.toString().padStart(2, "0");
    const e = episode.toString().padStart(2, "0");
    return `s${s}e${e}`;
}

function formatDate(air_date) {
    return new Date(air_date).toDateString();
}

async function printShowsTable(shows) {
    // fetch all shows
    const results = await Promise.all(shows.map(async show => {
        let data = null;
        try {
            // search using name when no id given
            if (!show.id) {
                const searchResult = await apiSeriesSearch(show.name);
                show.id = searchResult.results[0].id;
            }
            // get info on the show
            data = await apiSeriesInfo(show.id);
        } catch (ex) {
            console.warn("unable to fetch data for", show);
            console.warn(ex);
            console.warn();
        }
        return {show, data};
    }));
    // generate result data
    const columns = results
        .filter(({data}) => data)
        .filter(({show, data}) => commander.all || show.season < data.number_of_seasons)
        .map(({show, data}) => {
            const output = {
                id: data.id,
                name: data.name,
                status: data.status,
                seasons: `${show.season ? show.season : "*"}/${data.number_of_seasons}`,
            };
            const last = data.last_episode_to_air;
            if (last) {
                const last_nr = formatEpisodeNumber(last.season_number, last.episode_number);
                output.last = `${last_nr} ${formatDate(last.air_date)}`;
            }
            const next = data.next_episode_to_air;
            if (next) {
                const next_nr = formatEpisodeNumber(next.season_number, next.episode_number);
                output.next = `${next_nr} ${formatDate(next.air_date)}`;
            }
            return output;
        });
    // sort by name
    columns.sort((a, b) => a.name.localeCompare(b.name));
    // sort by status
    // columns.sort((a, b) => a.status.localeCompare(b.status));
    // output as columns
    console.log(columnify(columns, {
        config: {
            id: {align: 'right'},
            seasons: {align: 'right'},
        }
    }));
}

// read given file
const state = require(commander.file || "./state.json");
// process contained shows
printShowsTable(state.shows);
