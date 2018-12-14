// API documentation https://developers.themoviedb.org/3/getting-started/introduction

require("dotenv").config();
const URL = require("url").URL;
const fetch = require('node-fetch');

function buildUrl(path, queryParams) {
    const url = new URL(process.env.API_URL);
    url.pathname = "/" + process.env.API_VERSION + path;
    url.searchParams.append("api_key", process.env.API_KEY);
    if (queryParams) {
        Object.keys(queryParams).forEach(key => url.searchParams.append(key, queryParams[key]));
    }
    return url;
}

const api = async (path, params) => (await fetch(buildUrl(path, params))).json();
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

async function main(shows) {
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
            console.warn(ex);
        }
        return {show, data};
    }));
    // print results
    results.forEach(({show, data}) => {
        if (!data) {
            console.warn("unable to fetch data for", show);
            return;
        }
        console.log(`${data.name} - ${data.id} - ${data.status}`);
        if (show.season && show.season >= data.number_of_seasons) {
            console.log("=> nothing new");
        } else {
            const last = data.last_episode_to_air;
            if (last) {
                const last_nr = formatEpisodeNumber(last.season_number, last.episode_number);
                console.log(`  - last episode to air: ${last_nr} on ${formatDate(last.air_date)}`);
            }
            const next = data.next_episode_to_air;
            if (next) {
                const next_nr = formatEpisodeNumber(next.season_number, next.episode_number);
                console.log(`  - next episode to air: ${next_nr} on ${formatDate(next.air_date)}`);
            }
        }
        console.log("");
    });
}

// process state.json
const state = require("./state.json");
main(state.shows);
