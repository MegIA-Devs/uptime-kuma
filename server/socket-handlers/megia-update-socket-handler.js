const { checkLogin } = require("../util-server");
const { log } = require("../../src/util");
const { exec } = require("child_process");
const { promisify } = require("util");
const https = require("https");
const path = require("path");

const execAsync = promisify(exec);
const APP_ROOT = path.join(__dirname, "../../");
const UPSTREAM_OWNER = "louislam";
const UPSTREAM_REPO = "uptime-kuma";
const FORK_REPO = "MegIA-Devs/uptime-kuma";
const FORK_BRANCH = "megia-custom";

async function fetchUpstreamLatestRelease() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: "api.github.com",
            path: `/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/releases/latest`,
            method: "GET",
            headers: {
                "User-Agent": "MegIA-Uptime-Kuma/1.0",
                "Accept": "application/vnd.github.v3+json",
            },
        };

        const req = https.request(options, (res) => {
            let data = "";
            res.on("data", (chunk) => { data += chunk; });
            res.on("end", () => {
                try {
                    const release = JSON.parse(data);
                    if (release.tag_name) {
                        resolve({
                            tag: release.tag_name,
                            name: release.name || release.tag_name,
                            url: release.html_url,
                            publishedAt: release.published_at,
                            body: release.body ? release.body.slice(0, 600) : "",
                        });
                    } else {
                        reject(new Error("No release found"));
                    }
                } catch (e) {
                    reject(new Error("Failed to parse GitHub API response"));
                }
            });
        });
        req.setTimeout(10000, () => reject(new Error("GitHub API timeout")));
        req.on("error", reject);
        req.end();
    });
}

function getCurrentVersion() {
    // Clear require cache so we get fresh version after updates
    delete require.cache[require.resolve("../../package.json")];
    return require("../../package.json").version;
}

async function getGitCommit() {
    try {
        const { stdout } = await execAsync("git rev-parse --short HEAD", { cwd: APP_ROOT });
        return stdout.trim();
    } catch {
        return "unknown";
    }
}

async function getGitBranch() {
    try {
        const { stdout } = await execAsync("git rev-parse --abbrev-ref HEAD", { cwd: APP_ROOT });
        return stdout.trim();
    } catch {
        return "unknown";
    }
}

function compareVersions(current, upstream) {
    const clean = (v) => v.replace(/^v/, "").split(".").map(Number);
    const [ca, cb, cc] = clean(current);
    const [ua, ub, uc] = clean(upstream);
    if (ua > ca) return true;
    if (ua === ca && ub > cb) return true;
    if (ua === ca && ub === cb && uc > cc) return true;
    return false;
}

async function runStep(socket, step, message, command, options = {}) {
    socket.emit("megiaUpdateProgress", { step, message, status: "running" });
    log.info("megia-update", `Step [${step}]: ${message}`);
    try {
        const { stdout, stderr } = await execAsync(command, {
            cwd: APP_ROOT,
            timeout: 600000,
            env: { ...process.env, GIT_EDITOR: "true" },
            ...options,
        });
        const output = (stdout + stderr).trim().slice(0, 300);
        socket.emit("megiaUpdateProgress", { step, message: output || "OK", status: "done" });
        return output;
    } catch (e) {
        const errMsg = e.stderr ? e.stderr.slice(0, 300) : e.message;
        socket.emit("megiaUpdateProgress", { step, message: errMsg, status: "error" });
        throw new Error(`Step "${step}" failed: ${errMsg}`);
    }
}

module.exports.megiaUpdateSocketHandler = (socket) => {

    socket.on("megiaGetVersion", async (callback) => {
        try {
            checkLogin(socket);

            const currentVersion = getCurrentVersion();
            const currentCommit = await getGitCommit();
            const currentBranch = await getGitBranch();

            let upstream = null;
            let hasUpdate = false;

            try {
                upstream = await fetchUpstreamLatestRelease();
                hasUpdate = compareVersions(currentVersion, upstream.tag);
            } catch (e) {
                log.warn("megia-update", `Could not fetch upstream version: ${e.message}`);
            }

            callback({
                ok: true,
                data: {
                    currentVersion,
                    currentCommit,
                    currentBranch,
                    upstream,
                    hasUpdate,
                    hasGithubToken: Boolean(process.env.GITHUB_TOKEN),
                },
            });
        } catch (e) {
            callback({ ok: false, msg: e.message });
        }
    });

    socket.on("megiaApplyUpdate", async (callback) => {
        try {
            checkLogin(socket);

            const githubToken = process.env.GITHUB_TOKEN || null;

            try {
                // Step 1: Set remote URL with token for push auth
                if (githubToken) {
                    await runStep(socket, "auth",
                        "Configurando autenticación...",
                        `git remote set-url origin https://${githubToken}@github.com/${FORK_REPO}.git`
                    );
                }

                // Step 2: Fetch upstream
                await runStep(socket, "fetch",
                    "Descargando cambios del upstream (louislam/uptime-kuma)...",
                    "git fetch upstream --depth=100"
                );

                // Step 3: Merge upstream/master
                await runStep(socket, "merge",
                    "Integrando cambios del upstream en megia-custom...",
                    `git merge upstream/master --no-edit --allow-unrelated-histories`
                );

                // Step 4: Push to origin fork
                if (githubToken) {
                    await runStep(socket, "push",
                        "Enviando cambios al fork MegIA-Devs/uptime-kuma...",
                        `git push origin ${FORK_BRANCH}`
                    );

                    // Reset remote URL to remove token
                    await execAsync(
                        `git remote set-url origin https://github.com/${FORK_REPO}.git`,
                        { cwd: APP_ROOT }
                    );
                }

                // Step 5: Install deps
                await runStep(socket, "deps",
                    "Instalando dependencias (npm ci)...",
                    "npm ci"
                );

                // Step 6: Build frontend
                await runStep(socket, "build",
                    "Compilando frontend (npm run build)...",
                    "npm run build"
                );

                // Step 7: Done
                socket.emit("megiaUpdateProgress", {
                    step: "restart",
                    message: "Actualización completa. Reiniciando servidor en 3 segundos...",
                    status: "done",
                });

                callback({ ok: true, msg: "Actualización aplicada. El servidor se reiniciará." });

                // Exit — Docker restart policy brings it back with new code
                setTimeout(() => {
                    log.info("megia-update", "Restarting server after update...");
                    process.exit(0);
                }, 3000);

            } catch (e) {
                // Reset remote URL even on error
                if (githubToken) {
                    await execAsync(
                        `git remote set-url origin https://github.com/${FORK_REPO}.git`,
                        { cwd: APP_ROOT }
                    ).catch(() => {});
                }
                callback({ ok: false, msg: e.message });
            }

        } catch (e) {
            callback({ ok: false, msg: e.message });
        }
    });
};
