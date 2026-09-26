# Security

This page is for anyone deciding whether Visp Notes is safe to use: an individual developer or a company security review. It says what the extension reads and writes, what leaves your machine and what doesn't, how AI agents fit in, and which controls you have.

## In short

- **Visp Notes makes no network requests.** It has no telemetry, no account, no cloud sync and no update check of its own. VS Code updates it like any other extension.
- **It has no runtime dependencies.** The published extension contains its own code and a few checked-in assets (fonts, a spelling word list), and nothing installed from npm at run time.
- **It has no AI model of its own.** It gives the AI agents you already use **read-only** access to your notes. Whatever an agent reads is sent to *that agent's* provider under *that agent's* terms, not to Visp Notes.
- **It stays in the workspace folder.** It reads Markdown files there, and writes only the notes you edit plus the few files listed below.

## What it reads and writes

| Reads | Writes |
| --- | --- |
| `*.md` files in the open workspace, except those matched by `vispNotes.exclude` or larger than `vispNotes.maxNoteSizeKB` | The notes you edit, create, rename or delete |
| Its own settings | Wiki links in other notes, when you rename or move a note (`vispNotes.updateLinksOnFileMove.enabled`; see the README) |
| | Recovered drafts and delivered reminders, in VS Code's workspace storage |
| | Words you add to the spelling dictionary, in VS Code's global storage |
| | The MCP server file, copied into the extension's global storage on start-up |
| | The **path** of the note each window is showing, in the extension's global storage, while agent access is on (see below) |
| | `~/.codex/config.toml`, **only** when you choose Codex in **Connect AI Agents (MCP)…** and confirm |
| | `.mcp.json` or `.cursor/mcp.json`, **only** when you run **Connect AI Agents (MCP)…** and choose that option |

The editor and panels run in VS Code webviews under a strict content security policy. They can't load remote content or connect anywhere except the extension's own files.

## AI agents

Visp Notes offers the same read-only tools in two places:

- **Inside VS Code:** language-model tools that Copilot's agent mode, and other chat extensions using VS Code's tool API, can call.
- **Outside VS Code:** an MCP server that Claude Code, Codex, Cursor or any other MCP client can start, including through their VS Code extensions.

The tools can read notes, search them, walk the link graph and list tasks. They can't write, delete, run commands, reach the network, or read anything that isn't an indexed Markdown note under the chosen folder. There's no "read this path" input, and symbolic links aren't followed.

**The data flow to keep in mind:**

```
your notes ──(Visp Notes tool, on your machine)──► the agent ──► the agent's model provider
```

Visp Notes decides *what the agent can see*. The agent's provider and its terms decide *what happens to it afterwards*.

### If your company provides GitHub Copilot

This is the common corporate setup, and the data path is the one your company has already approved:

- **Inside VS Code,** notes that Copilot reads through these tools go to GitHub Copilot, under your organization's Copilot agreement. That's the same service and the same terms that already cover the code Copilot sees. Visp Notes adds no new vendor or data processor.
- **Copilot content exclusions aren't visible to extensions.** If your organization excludes paths from Copilot, Visp Notes can't see those rules, so a note the rules would cover could still reach Copilot through these tools. **Mirror the rules in `vispNotes.agents.exclude`** (below), or add `.vscode/settings.json` to the repository so the rules travel with it.
- **Your administrators keep their existing controls.** VS Code and GitHub Copilot let an organization restrict agent mode, extension-contributed tools and MCP servers through their enterprise policies. Those apply to Visp Notes like any other extension.
- **The MCP server is a different path.** It serves whatever MCP client you connect. That client (Claude Code, Codex, Cursor, anything else) sends what it reads to *its own* provider, which may not be one your company has approved. If your company only permits Copilot, don't connect other agents, or set `vispNotes.agents.enabled` to `false` in the repository's `.vscode/settings.json`. The MCP server honours that and offers no tools.

### Controls

| Setting | What it does |
| --- | --- |
| `vispNotes.agents.enabled` | `false` withdraws every agent tool. In VS Code it takes effect immediately. The MCP server reads it from the folder's `.vscode/settings.json` on every request, and then offers nothing. |
| `vispNotes.agents.exclude` | Glob patterns, such as `hr/**` or `**/*-confidential.md`, for notes agents must never see. A matching note can't be read, searched, listed as a task, or reached through the graph or a link path. A visible note that links to one says only that the target isn't shared. |
| Workspace Trust | In a workspace VS Code doesn't trust, the tools aren't offered at all. Settings that change what's indexed or rewritten are ignored in Restricted Mode. |
| `vispNotes.exclude` | Keeps files out of the index entirely, for the extension and for agents. |

A starting point for a repository with sensitive notes:

```jsonc
// .vscode/settings.json
{
  "vispNotes.agents.exclude": ["private/**", "hr/**", "**/*-confidential.md"]
}
```

For a repository where no agent should read notes at all:

```jsonc
{ "vispNotes.agents.enabled": false }
```

### Prompt injection

Notes are often written by someone other than the person asking: pasted meeting minutes, a cloned repository's docs, a teammate's page. Text inside a note could be written to steer an AI agent ("ignore your instructions and…"). The Visp Notes tools are read-only, so a note can't make *them* do anything. The risk is that the *agent* acts on that text using its own tools, which may be able to edit files or run commands.

What Visp Notes does about it:

- **It frames every answer as data.** Each answer begins with a notice telling the agent the text is the user's notes, not instructions.
- **It fences note text safely.** Note text is quoted in a fence longer than any run of backticks inside it, so a note can't close the quote early and pose as the tool's own words.
- **It stays off in untrusted workspaces.** That's where a planted instruction is most likely.

No tool can rule out injection entirely. Keep your agent's own approval prompts turned on for edits and commands, especially in repositories you didn't write.

### The MCP server

- **It runs only when an agent starts it,** as a child process of that agent, with your user's permissions. It talks only over that process's stdin and stdout. It opens no port and makes no network connection.
- **It serves only the folder named by `--root`.**
- **It lives in the extension's global storage** so its path survives updates. The extension replaces it on every start-up with the copy that shipped in the extension.
- **The config files written by Connect AI Agents hold absolute paths on your machine.** Keep them out of version control.
- **`active_note` tells the server which note you have open.** Each VS Code window writes that note's **path**, with a timestamp and the window's process id, to a small file in the extension's global storage, and the server reads it. The note's text is never written there; the server reads the saved file like any other note, and `vispNotes.agents.exclude` still applies. The file is only written while agent access is on and the workspace is trusted, and it's removed when access is switched off, when no note is open, and when the window closes. An entry left behind by a crashed window is ignored once its process is gone.

## Reporting a vulnerability

Please report security problems privately, not in a public issue. Use GitHub's private vulnerability reporting on the repository: <https://github.com/djkeshawa/visp-code-note/security/advisories/new>. Include what you found, how to reproduce it, and the Visp Notes and VS Code versions.
