
/************************************************************
 HOOPSTATS - WEBSITE FUNCTIONALITY

 Connects the HTML website to Google Apps Script.
 Handles:
 - Roster management
 - Game creation
 - Player statistics entry
 - Input validation
 - Player dashboards
 - Team dashboards
************************************************************/


// ==========================================================
// CONFIGURATION
// ==========================================================

const API_URL = "https://script.google.com/macros/s/AKfycbwPJyY5YMTDhuNUDcbgr-LXQCtEq_aVlUF-IQh4iVy7VQhXNZabTFY_uI-pc24Am0eTsw/exec";


// ==========================================================
// GLOBAL DATA
// ==========================================================

let roster = [];
let games = [];
let selectedPlayerData = null;
let teamData = [];


// ==========================================================
// GENERAL HELPERS
// ==========================================================

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

function formatNumber(value, decimals = 1) {
    if (value === null || value === undefined ||
        !Number.isFinite(Number(value))) {
        return "—";
    }
    return Number(value).toFixed(decimals);
}

function formatPercentage(value) {
    if (value === null || value === undefined ||
        !Number.isFinite(Number(value))) {
        return "—";
    }
    return (Number(value) * 100).toFixed(1) + "%";
}

function showMessage(message, type = "success") {
    const box = document.getElementById("globalMessage");

    box.textContent = message;
    box.className = "message " + type;

    window.scrollTo({ top: 0, behavior: "smooth" });

    setTimeout(() => {
        box.classList.add("hidden");
    }, 5000);
}

function showEmptyMessage(element, message, columns) {
    element.innerHTML =
        `<tr><td colspan="${columns}" class="empty">${escapeHTML(message)}</td></tr>`;
}


// ==========================================================
// GOOGLE APPS SCRIPT CONNECTION
// ==========================================================

// GET requests use JSONP to avoid cross-origin restrictions.

function apiGet(action, params = {}) {
    return new Promise((resolve, reject) => {
        if (!API_URL || API_URL.includes("PASTE_YOUR")) {
            reject(new Error("Please configure your Apps Script URL."));
            return;
        }

        const callbackName =
            "hoopStatsCallback_" +
            Date.now() + "_" +
            Math.random().toString(36).slice(2);

        const script = document.createElement("script");

        const query = new URLSearchParams({
            action,
            ...params,
            callback: callbackName
        });

        let finished = false;

        const timeout = setTimeout(() => {
            if (!finished) {
                finished = true;
                delete window[callbackName];
                script.remove();
                reject(new Error("The server did not respond. Please try again."));
            }
        }, 15000);

        window[callbackName] = function(response) {
            if (finished) return;

            finished = true;
            clearTimeout(timeout);
            delete window[callbackName];
            script.remove();

            if (response && response.success) {
                resolve(response.data);
            } else {
                reject(new Error(response?.error || "Server error."));
            }
        };

        script.onerror = function() {
            if (finished) return;

            finished = true;
            clearTimeout(timeout);
            delete window[callbackName];
            script.remove();

            reject(new Error("Unable to connect to Google Apps Script."));
        };

        script.src = API_URL + "?" + query.toString();

        document.body.appendChild(script);
    });
}


// POST requests use a simple text/plain request.
// The response is opaque because of cross-origin restrictions.
// We verify successful writes by retrieving the updated data.

async function apiPost(payload) {
    if (!API_URL || API_URL.includes("PASTE_YOUR")) {
        throw new Error("Please configure your Apps Script URL.");
    }

    await fetch(API_URL, {
        method: "POST",
        mode: "no-cors",
        headers: {
            "Content-Type": "text/plain;charset=UTF-8"
        },
        body: JSON.stringify(payload)
    });
}


// Retry retrieval to allow Google Sheets time to update.

async function verifySubmission(checkFunction) {
    for (let attempt = 0; attempt < 6; attempt++) {
        await delay(1000);

        try {
            const result = await checkFunction();

            if (result) return true;

        } catch (error) {
            // Try again.
        }
    }

    throw new Error(
        "We could not verify the submission. Please refresh the page " +
        "and check the database before submitting again."
    );
}


// ==========================================================
// TAB NAVIGATION
// ==========================================================

document.querySelectorAll(".tab").forEach(button => {
    button.addEventListener("click", async () => {
        document.querySelectorAll(".tab").forEach(tab =>
            tab.classList.remove("active")
        );

        document.querySelectorAll(".tab-content").forEach(section =>
            section.classList.remove("active")
        );

        button.classList.add("active");

        const tabName = button.dataset.tab;
        document.getElementById(tabName).classList.add("active");

        try {
            if (tabName === "roster") {
                await loadRoster();
            }

            if (tabName === "entry") {
                await loadEntryOptions();
            }

            if (tabName === "players") {
                await loadRoster();
                populatePlayerAnalysis();
            }

            if (tabName === "team") {
                await loadTeamDashboard();
            }

        } catch (error) {
            showMessage(error.message, "error");
        }
    });
});


// ==========================================================
// ROSTER MANAGEMENT
// ==========================================================

async function loadRoster() {
    roster = await apiGet("getRoster");

    renderRoster();
    populateDropdowns();
}

function renderRoster() {
    const table = document.getElementById("rosterTable");

    document.getElementById("rosterCount").textContent =
        roster.length + " Active Players";

    if (roster.length === 0) {
        showEmptyMessage(table, "No players have been added yet.", 5);
        return;
    }

    table.innerHTML = roster.map(player => `
        <tr>
            <td>${escapeHTML(player.jerseyNumber)}</td>
            <td><strong>${escapeHTML(player.playerName)}</strong></td>
            <td>${escapeHTML(player.playerID)}</td>
            <td><span class="status-active">Active</span></td>
            <td>
                <button class="small-action"
                    onclick="deactivatePlayer('${escapeHTML(player.playerID)}')">
                    Deactivate
                </button>
            </td>
        </tr>
    `).join("");
}

function populateDropdowns() {
    const options = roster.map(player => `
        <option value="${escapeHTML(player.playerID)}">
            #${escapeHTML(player.jerseyNumber)} -
            ${escapeHTML(player.playerName)}
        </option>
    `).join("");

    const selects = [
        "selectedPlayer",
        "playerAnalysisSelect"
    ];

    selects.forEach(id => {
        const select = document.getElementById(id);
        const previousValue = select.value;

        select.innerHTML =
            '<option value="">Select a player...</option>' + options;

        if (roster.some(p => p.playerID === previousValue)) {
            select.value = previousValue;
        }
    });
}


document.getElementById("rosterForm").addEventListener(
    "submit",
    async function(event) {
        event.preventDefault();

        const name = document.getElementById("playerName").value.trim();
        const jersey = document.getElementById("jerseyNumber").value;

        if (!name || !/^\d{1,2}$/.test(jersey)) {
            showMessage(
                "Enter a player name and a jersey number from 0 to 99.",
                "error"
            );
            return;
        }

        if (roster.some(p =>
            p.playerName.toLowerCase() === name.toLowerCase()
        )) {
            showMessage("This player is already on the roster.", "error");
            return;
        }

        if (roster.some(p =>
            String(p.jerseyNumber) === String(jersey)
        )) {
            showMessage(
                "This jersey number is already assigned to an active player.",
                "error"
            );
            return;
        }

        try {
            const button = this.querySelector("button");
            button.disabled = true;
            button.textContent = "Adding...";

            await apiPost({
                action: "addPlayer",
                playerName: name,
                jerseyNumber: jersey
            });

            await verifySubmission(async () => {
                await loadRoster();
                return roster.some(p =>
                    p.playerName.toLowerCase() === name.toLowerCase()
                );
            });

            this.reset();
            showMessage(name + " was successfully added to the roster.");

        } catch (error) {
            showMessage(error.message, "error");

        } finally {
            const button = this.querySelector("button");
            button.disabled = false;
            button.textContent = "+ Add Player";
        }
    }
);


async function deactivatePlayer(playerID) {
    const player = roster.find(p => p.playerID === playerID);

    if (!player) return;

    if (!confirm(
        "Remove " + player.playerName +
        " from the active roster? Historical statistics will remain."
    )) return;

    try {
        await apiPost({
            action: "deactivatePlayer",
            playerID
        });

        await verifySubmission(async () => {
            await loadRoster();
            return !roster.some(p => p.playerID === playerID);
        });

        showMessage(player.playerName + " was deactivated.");

    } catch (error) {
        showMessage(error.message, "error");
    }
}

document.getElementById("refreshRoster").addEventListener(
    "click",
    () => loadRoster()
        .then(() => showMessage("Roster refreshed."))
        .catch(error => showMessage(error.message, "error"))
);


// ==========================================================
// GAME MANAGEMENT
// ==========================================================

async function loadGames() {
    games = await apiGet("getGames");

    const select = document.getElementById("selectedGame");
    const previousValue = select.value;

    select.innerHTML =
        '<option value="">Select a game...</option>' +
        games.map(game => `
            <option value="${escapeHTML(game.gameID)}">
                ${escapeHTML(game.gameDate)} -
                ${escapeHTML(game.opponent)}
            </option>
        `).join("");

    if (games.some(g => g.gameID === previousValue)) {
        select.value = previousValue;
    }
}

async function loadEntryOptions() {
    await Promise.all([
        loadRoster(),
        loadGames()
    ]);
}


document.getElementById("gameForm").addEventListener(
    "submit",
    async function(event) {
        event.preventDefault();

        const opponent = document.getElementById("opponent").value.trim();
        const gameDate = document.getElementById("gameDate").value;

        if (!opponent || !gameDate) {
            showMessage("Enter an opponent and game date.", "error");
            return;
        }

        const button = this.querySelector("button");

        try {
            button.disabled = true;
            button.textContent = "Creating...";

            await apiPost({
                action: "addGame",
                opponent,
                gameDate
            });

            await verifySubmission(async () => {
                await loadGames();

                return games.some(game =>
                    game.opponent.toLowerCase() === opponent.toLowerCase() &&
                    String(game.gameDate).slice(0, 10) === gameDate
                );
            });

            const newGame = games.find(game =>
                game.opponent.toLowerCase() === opponent.toLowerCase() &&
                String(game.gameDate).slice(0, 10) === gameDate
            );

            document.getElementById("selectedGame").value =
                newGame.gameID;

            document.getElementById("gameMessage").textContent =
                "Game created successfully! You can now enter player statistics.";

            this.reset();

        } catch (error) {
            showMessage(error.message, "error");

        } finally {
            button.disabled = false;
            button.textContent = "Create Game";
        }
    }
);


// ==========================================================
// STATISTICS ENTRY AND VALIDATION
// ==========================================================

const statFields = [
    "twoPM",
    "twoPA",
    "threePM",
    "threePA",
    "ftm",
    "fta",
    "offensiveRebounds",
    "defensiveRebounds",
    "assists",
    "steals",
    "blocks",
    "turnovers",
    "personalFouls",
    "minutesPlayed"
];

function getStatValues() {
    const values = {};

    statFields.forEach(field => {
        values[field] = Number(
            document.getElementById(field).value
        );
    });

    return values;
}

function calculatePoints(values) {
    return (
        values.twoPM * 2 +
        values.threePM * 3 +
        values.ftm
    );
}

function validateStats(values) {
    const errors = [];

    statFields.forEach(field => {
        const input = document.getElementById(field);

        if (input.value === "" ||
            !Number.isFinite(values[field]) ||
            values[field] < 0) {
            errors.push(field + " must be a non-negative number.");
        }

        if (
            field !== "minutesPlayed" &&
            !Number.isInteger(values[field])
        ) {
            errors.push(field + " must be a whole number.");
        }
    });

    if (values.twoPM > values.twoPA) {
        errors.push(
            "Two-point shots made cannot exceed attempts."
        );
    }

    if (values.threePM > values.threePA) {
        errors.push(
            "Three-point shots made cannot exceed attempts."
        );
    }

    if (values.ftm > values.fta) {
        errors.push(
            "Free throws made cannot exceed attempts."
        );
    }

    if (values.minutesPlayed > 60) {
        errors.push(
            "Minutes played cannot exceed 60 for this project."
        );
    }

    if (!document.getElementById("selectedGame").value) {
        errors.push("Please select a game.");
    }

    if (!document.getElementById("selectedPlayer").value) {
        errors.push("Please select a player.");
    }

    return errors;
}

function updatePointsPreview() {
    const values = getStatValues();

    document.getElementById("pointsPreview").textContent =
        calculatePoints(values);
}

statFields.forEach(field => {
    document.getElementById(field).addEventListener(
        "input",
        updatePointsPreview
    );
});


function clearStatsForm() {
    document.getElementById("statsForm").reset();

    statFields.forEach(field => {
        document.getElementById(field).value = "0";
    });

    document.getElementById("pointsPreview").textContent = "0";

    document.getElementById("validationErrors").classList.add("hidden");
}


document.getElementById("clearStats").addEventListener(
    "click",
    clearStatsForm
);


document.getElementById("statsForm").addEventListener(
    "submit",
    async function(event) {
        event.preventDefault();

        const errorsBox = document.getElementById("validationErrors");
        const values = getStatValues();
        const errors = validateStats(values);

        if (errors.length > 0) {
            errorsBox.innerHTML =
                "<strong>Please correct the following errors:</strong>" +
                "<ul>" +
                errors.map(error =>
                    `<li>${escapeHTML(error)}</li>`
                ).join("") +
                "</ul>";

            errorsBox.classList.remove("hidden");
            return;
        }

        errorsBox.classList.add("hidden");

        const playerID =
            document.getElementById("selectedPlayer").value;

        const gameID =
            document.getElementById("selectedGame").value;

        const payload = {
            action: "addPlayerStats",
            playerID,
            gameID,
            ...values
        };

        const button = this.querySelector(
            'button[type="submit"]'
        );

        try {
            button.disabled = true;
            button.textContent = "Submitting...";

            await apiPost(payload);

            await verifySubmission(async () => {
                const data = await apiGet(
                    "getPlayerStats",
                    { playerID }
                );

                return data.gameStatistics.some(
                    record => record.gameID === gameID
                );
            });

            clearStatsForm();

            showMessage(
                "Player statistics successfully added to the database!"
            );

        } catch (error) {
            showMessage(error.message, "error");

        } finally {
            button.disabled = false;
            button.textContent = "Add to Database";
        }
    }
);


// ==========================================================
// PLAYER STATISTICS DASHBOARD
// ==========================================================

function populatePlayerAnalysis() {
    const select = document.getElementById(
        "playerAnalysisSelect"
    );

    if (select.value) {
        loadPlayerDashboard(select.value);
    }
}

document.getElementById("playerAnalysisSelect").addEventListener(
    "change",
    function() {
        if (this.value) {
            loadPlayerDashboard(this.value);
        } else {
            document.getElementById("playerDashboard")
                .classList.add("hidden");
        }
    }
);


async function loadPlayerDashboard(playerID) {
    try {
        const data = await apiGet(
            "getPlayerStats",
            { playerID }
        );

        selectedPlayerData = data;

        document.getElementById("playerDashboard")
            .classList.remove("hidden");

        document.getElementById("dashboardPlayerName").textContent =
            data.player.playerName;

        document.getElementById("dashboardPlayerInfo").textContent =
            "Jersey #" + data.player.jerseyNumber +
            " | " + data.gamesPlayed + " Games Played";

        renderPlayerCards(data);
        renderPlayerGames(data);

    } catch (error) {
        showMessage(error.message, "error");
    }
}


function createMetricCard(label, value, subtitle = "") {
    return `
        <div class="metric-card">
            <div class="metric-label">${escapeHTML(label)}</div>
            <div class="metric-value">${escapeHTML(value)}</div>
            <div class="metric-subtitle">${escapeHTML(subtitle)}</div>
        </div>
    `;
}


function renderPlayerCards(data) {
    const a = data.averages;

    const cards = [
        ["Points Per Game", formatNumber(a.pointsPerGame), "Scoring average"],
        ["Rebounds Per Game", formatNumber(a.reboundsPerGame), "Total rebounds"],
        ["Assists Per Game", formatNumber(a.assistsPerGame), "Playmaking"],
        ["Efficiency", formatNumber(a.efficiencyPerGame), "EFF per game"],
        ["Steals Per Game", formatNumber(a.stealsPerGame), "Defensive production"],
        ["Blocks Per Game", formatNumber(a.blocksPerGame), "Rim protection"],
        ["Turnovers Per Game", formatNumber(a.turnoversPerGame), "Ball security"],
        ["Minutes Per Game", formatNumber(a.minutesPerGame), "Playing time"]
    ];

    document.getElementById("playerCards").innerHTML =
        cards.map(card =>
            createMetricCard(...card)
        ).join("");

    const shooting = [
        ["Field Goal %", formatPercentage(a.fieldGoalPercentage)],
        ["Three Point %", formatPercentage(a.threePointPercentage)],
        ["Free Throw %", formatPercentage(a.freeThrowPercentage)],
        ["True Shooting %", formatPercentage(a.trueShootingPercentage)]
    ];

    document.getElementById("shootingCards").innerHTML =
        shooting.map(card =>
            createMetricCard(card[0], card[1], "Season shooting efficiency")
        ).join("");
}


function renderPlayerGames(data) {
    const table = document.getElementById("playerGameTable");

    if (data.gameStatistics.length === 0) {
        showEmptyMessage(table, "No games recorded for this player.", 9);
        return;
    }

    const sorted = [...data.gameStatistics].sort((a, b) =>
        String(b.gameDate).localeCompare(String(a.gameDate))
    );

    table.innerHTML = sorted.map(game => {
        const s = game.statistics;

        return `
            <tr>
                <td>${escapeHTML(String(game.gameDate).slice(0, 10))}</td>
                <td>${escapeHTML(game.opponent)}</td>
                <td><strong>${s.points}</strong></td>
                <td>${s.rebounds}</td>
                <td>${s.assists}</td>
                <td>${formatPercentage(s.fieldGoalPercentage)}</td>
                <td>${formatPercentage(s.threePointPercentage)}</td>
                <td>${formatPercentage(s.trueShootingPercentage)}</td>
                <td>${s.efficiency}</td>
            </tr>
        `;
    }).join("");
}


document.getElementById("refreshPlayer").addEventListener(
    "click",
    () => {
        const id = document.getElementById(
            "playerAnalysisSelect"
        ).value;

        if (id) {
            loadPlayerDashboard(id);
        }
    }
);


// ==========================================================
// TEAM STATISTICS DASHBOARD
// ==========================================================

async function loadTeamDashboard() {
    await loadRoster();

    teamData = await apiGet("getTeamStats");

    renderTeamDashboard();
}


function renderTeamDashboard() {
    const playersWithGames = teamData.filter(
        player => player.gamesPlayed > 0
    );

    const totalGames = games.length;

    const totals = {
        points: 0,
        rebounds: 0,
        assists: 0
    };

    playersWithGames.forEach(player => {
        const a = player.averages;
        totals.points += a.pointsPerGame * player.gamesPlayed;
        totals.rebounds += a.reboundsPerGame * player.gamesPlayed;
        totals.assists += a.assistsPerGame * player.gamesPlayed;
    });

    const playerGameCount = playersWithGames.reduce(
        (sum, player) => sum + player.gamesPlayed,
        0
    );

    const metrics = [
        createMetricCard(
            "Active Players",
            roster.length,
            "Current roster"
        ),
        createMetricCard(
            "Games Recorded",
            totalGames,
            "Games in database"
        ),
        createMetricCard(
            "Points Per Player-Game",
            playerGameCount
                ? formatNumber(totals.points / playerGameCount)
                : "—",
            "Average scoring"
        ),
        createMetricCard(
            "Rebounds Per Player-Game",
            playerGameCount
                ? formatNumber(totals.rebounds / playerGameCount)
                : "—",
            "Average rebounding"
        ),
        createMetricCard(
            "Assists Per Player-Game",
            playerGameCount
                ? formatNumber(totals.assists / playerGameCount)
                : "—",
            "Average assists"
        )
    ];

    document.getElementById("teamCards").innerHTML =
        metrics.join("");

    renderLeaderboard();
}


function renderLeaderboard() {
    const metric = document.getElementById(
        "leaderboardMetric"
    ).value;

    const players = teamData
        .filter(player => player.gamesPlayed > 0)
        .map(player => ({
            name: player.player.playerName,
            number: player.player.jerseyNumber,
            games: player.gamesPlayed,
            value: player.averages[metric]
        }))
        .sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));

    const table = document.getElementById("leaderboardTable");

    if (players.length === 0) {
        showEmptyMessage(
            table,
            "No player statistics have been recorded yet.",
            4
        );
        return;
    }

    table.innerHTML = players.map((player, index) => `
        <tr>
            <td><strong>${index + 1}</strong></td>
            <td>#${escapeHTML(player.number)} -
                ${escapeHTML(player.name)}</td>
            <td>${player.games}</td>
            <td><strong>${
                metric === "trueShootingPercentage"
                    ? formatPercentage(player.value)
                    : formatNumber(player.value)
            }</strong></td>
        </tr>
    `).join("");
}


document.getElementById("leaderboardMetric").addEventListener(
    "change",
    renderLeaderboard
);

document.getElementById("refreshTeam").addEventListener(
    "click",
    () => loadTeamDashboard()
        .then(() => showMessage("Team statistics refreshed."))
        .catch(error => showMessage(error.message, "error"))
);


// ==========================================================
// INITIAL PAGE LOAD
// ==========================================================

async function initializeWebsite() {
    try {
        await loadRoster();
        await loadGames();

    } catch (error) {
        showMessage(
            "Unable to connect to the database: " + error.message,
            "error"
        );
    }
}

initializeWebsite();
