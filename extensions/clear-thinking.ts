// clear-thinking.ts — /clear-thinking removes thinking blocks from this
// session's stored history while leaving the thinking level untouched.
//
// Why: session history is append-only and same-model replay sends signed
// thinking blocks back to the provider on every request, so dropping old
// reasoning means rewriting the session JSONL. /reload re-fires session_start
// but does NOT re-read the session file, so the file rewrite is followed by a
// resume of the same session to rebind the in-memory transcript.
//
// Usage:
//   /clear-thinking
//   (pi rewrites the file and resumes the session; thinking stays enabled)
//
// Remove this file to uninstall.

import { readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface StripThinkingResult {
	text: string;
	/** Number of thinking blocks removed. */
	blocks: number;
	/** Total characters of thinking text removed. */
	chars: number;
}

function isThinkingBlock(block: unknown): block is { type: "thinking"; thinking?: string } {
	return typeof block === "object" && block !== null && (block as { type?: unknown }).type === "thinking";
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Drop `thinking` content blocks from every assistant message in the JSONL.
 *
 * Entry ids, parent links, labels, and non-message entries are untouched, so
 * the session tree and resume behavior stay intact. Content can end up empty;
 * both the Anthropic and OpenAI-compatible adapters skip empty assistant
 * messages instead of erroring.
 */
export function stripThinkingFromSessionText(text: string): StripThinkingResult {
	let blocks = 0;
	let chars = 0;
	const lines = text.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		if (line.trim() === "") continue;

		let entry: unknown;
		try {
			entry = JSON.parse(line);
		} catch (error) {
			throw new Error(`line ${i + 1} is not valid JSON: ${errorMessage(error)}`);
		}
		if (typeof entry !== "object" || entry === null) continue;

		const record = entry as { type?: unknown; message?: { role?: unknown; content?: unknown } };
		if (record.type !== "message" || record.message?.role !== "assistant") continue;
		const content = record.message.content;
		if (!Array.isArray(content)) continue;

		const kept: unknown[] = [];
		for (const block of content) {
			if (!isThinkingBlock(block)) {
				kept.push(block);
				continue;
			}
			blocks++;
			chars += block.thinking?.length ?? 0;
		}
		if (kept.length === content.length) continue;

		record.message.content = kept;
		lines[i] = JSON.stringify(record);
	}

	return { text: lines.join("\n"), blocks, chars };
}

export default function clearThinking(pi: ExtensionAPI) {
	pi.registerCommand("clear-thinking", {
		description: "Remove thinking blocks from this session's history (thinking stays enabled)",
		handler: async (args, ctx) => {
			if (args.trim() !== "") {
				ctx.ui.notify("Usage: /clear-thinking (no arguments)", "warning");
				return;
			}

			const sessionFile = ctx.sessionManager.getSessionFile();
			if (!sessionFile) {
				ctx.ui.notify("This session is not persisted; there is no history to clear.", "warning");
				return;
			}

			// Entries are appended as a turn settles; never rewrite underneath a live turn.
			await ctx.waitForIdle();

			let result: StripThinkingResult;
			try {
				result = stripThinkingFromSessionText(readFileSync(sessionFile, "utf8"));
			} catch (error) {
				ctx.ui.notify(`Could not parse session history: ${errorMessage(error)}`, "error");
				return;
			}
			if (result.blocks === 0) {
				ctx.ui.notify("No thinking blocks in this session's history.", "info");
				return;
			}

			// Write-then-rename keeps the session file intact if the process dies mid-write.
			const tempFile = `${sessionFile}.clear-thinking.tmp`;
			try {
				writeFileSync(tempFile, result.text, { mode: statSync(sessionFile).mode });
				renameSync(tempFile, sessionFile);
			} catch (error) {
				try {
					unlinkSync(tempFile);
				} catch {
					// Best effort: the temp file may not exist.
				}
				ctx.ui.notify(`Could not rewrite session history: ${errorMessage(error)}`, "error");
				return;
			}

			const cleared = `Cleared ${result.blocks} thinking block${result.blocks === 1 ? "" : "s"} (${result.chars.toLocaleString()} chars)`;
			ctx.ui.notify(`${cleared}; reloading session…`, "info");

			const switchResult = await ctx.switchSession(sessionFile, {
				withSession: async (newCtx) => {
					newCtx.ui.notify(cleared, "info");
				},
			});
			if (switchResult.cancelled) {
				ctx.ui.notify(
					"History was cleared on disk, but the session reload was cancelled. Run /resume to pick up the change.",
					"warning",
				);
			}
		},
	});
}
