/**
 * @module scribe/scribe
 * The Scribe module — merges inbox decisions and writes session logs/history.
 */
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { listInbox, consumeInboxFile } from "./drop-box.js";
function decisionsPath(teamRoot) {
    return join(teamRoot, ".squad", "decisions.md");
}
function logDir(teamRoot) {
    return join(teamRoot, ".squad", "log");
}
function historyPath(teamRoot, agentName) {
    return join(teamRoot, ".squad", "agents", agentName, "history.md");
}
async function ensureFile(filePath, initial = "") {
    await mkdir(dirname(filePath), { recursive: true });
    try {
        await readFile(filePath, "utf8");
    }
    catch {
        await writeFile(filePath, initial, "utf8");
    }
}
/**
 * Merges all inbox decisions into .squad/decisions.md.
 * Returns the count of entries merged.
 */
export async function mergeDecisions(options) {
    const { teamRoot } = options;
    const inboxFiles = await listInbox(teamRoot);
    if (inboxFiles.length === 0)
        return 0;
    const target = decisionsPath(teamRoot);
    await ensureFile(target);
    let merged = 0;
    for (const filePath of inboxFiles) {
        const content = await consumeInboxFile(filePath);
        await appendFile(target, `\n\n${content.trimEnd()}\n`, "utf8");
        merged += 1;
    }
    return merged;
}
/**
 * Appends a session log entry to .squad/log/{ISO-timestamp}-{topic}.md
 */
export async function writeSessionLog(options, topic, content) {
    const { teamRoot } = options;
    const dir = logDir(teamRoot);
    await mkdir(dir, { recursive: true });
    const safeTopic = topic.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 60);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = join(dir, `${timestamp}-${safeTopic}.md`);
    await writeFile(filePath, content, "utf8");
}
/**
 * Appends to an agent's history.md.
 */
export async function appendToHistory(teamRoot, agentName, content) {
    const filePath = historyPath(teamRoot, agentName);
    await ensureFile(filePath);
    await appendFile(filePath, `\n\n${content.trimEnd()}\n`, "utf8");
}
//# sourceMappingURL=scribe.js.map