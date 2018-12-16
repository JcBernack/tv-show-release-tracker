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

const state = {
    pending: 0,
    queue: [],
    backoff: null,
    backoffDelay: 0,
    done: 0,
    total: 0,
};

function printProgress() {
    process.stdout.clearScreenDown();
    process.stdout.write(`progress ${state.done}/${state.total}`);
    process.stdout.write("  -  ");
    process.stdout.write(`requests pending/queued ${state.pending}/${state.queue.length}`);
    if (state.backoffDelay) process.stdout.write(` (rate limited, backing off for ${state.backoffDelay} seconds)`);
    process.stdout.cursorTo(0);
}

function print(str) {
    process.stdout.clearScreenDown();
    process.stdout.write(str + "\n");
}

function buildUrl(path, queryParams) {
    const url = new URL(process.env.API_URL);
    url.pathname = "/" + process.env.API_VERSION + path;
    url.searchParams.append("api_key", process.env.API_KEY);
    if (queryParams) Object.keys(queryParams).forEach(key => url.searchParams.append(key, queryParams[key]));
    return url;
}

function setBackoff(seconds) {
    if (state.backoff != null) return;
    // add a second to make sure we don't get blocked again
    seconds++;
    state.backoffDelay = seconds;
    state.backoff = new Promise(resolve => setTimeout(() => {
        state.backoff = null;
        state.backoffDelay = 0;
        return resolve();
    }, seconds * 1000));
}

const api = async (path, params) => {
    if (state.pending >= process.env.API_CONCURRENT_REQUEST) {
        printProgress();
        await new Promise(resolve => state.queue.push(resolve));
    }
    state.pending++;
    printProgress();
    const url = buildUrl(path, params);
    let response;
    while (true) {
        // wait if we are rate limited
        if (state.backoff != null) await state.backoff;
        printProgress();
        // try to fetch data
        response = await fetch(url);
        // check if we are rate limited
        if (response.status === 429) {
            setBackoff(parseInt(response.headers.get("retry-after")));
            printProgress();
            continue;
        }
        // try not to run into the rate limit
        const remaining = parseInt(response.headers.get("X-RateLimit-Remaining"));
        if (remaining < state.pending) {
            const reset = parseInt(response.headers.get("X-RateLimit-Reset"));
            const now = Date.now() / 1000 | 0;
            setBackoff(reset - now);
        }
        break;
    }
    state.pending--;
    printProgress();
    if (state.queue.length) {
        const resolve = state.queue.shift();
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
    state.total = shows.length;
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
            print(`unable to fetch data for ${show}`);
            print(ex);
            print();
        }
        state.done++;
        printProgress();
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
    print(columnify(columns, {
        config: {
            id: {align: 'right'},
            seasons: {align: 'right'},
        }
    }));
}

// read given file
const file = require(commander.file || "./state.json");
// process contained shows
printShowsTable(file.shows);
