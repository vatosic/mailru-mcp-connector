# Mail.ru MCP Connector

[Русский](README.md) · [Security](SECURITY.md) · [Sending](docs/SENDING.md)

An independent, self-hosted MCP server for a personal Mail.ru mailbox.
**Not an official Mail.ru, VK or OpenAI product; no affiliation or endorsement
is claimed.** This repository is not a published ChatGPT directory app and makes
no promise of directory acceptance. Source code is available under the
[MIT license](LICENSE). package.json retains private=true to prevent accidental
npm publishing; this does not prevent self-hosted installation from GitHub.

Each user runs a separate instance on their own trusted computer/server. The
mailbox owner keeps 2FA enabled, creates a separate application password and
enters it only on that machine. The developer receives neither credentials nor
mailbox access. Selected messages are passed to the owner's MCP client, such as
their AI application, under that client's data policies.

## Tools

| Tool | Behavior |
| --- | --- |
| `list_folders` | Only administrator-allowed folders; INBOX by default |
| `search_mail` | Newest 500 messages in a folder, at most 20 results |
| `read_mail` | Read by UID and UIDVALIDITY without changing Seen |
| `preview_reply` | Opt-in: inspect actual reply target and thread headers |
| `send_mail` | Opt-in: one plaintext message to one recipient |
| `reply_mail` | Opt-in: reply to a verified original message |
| `send_status` | Opt-in: inspect a durable submission record |

Only the three read tools exist by default. No deletion, moves, IMAP APPEND,
attachment downloads, outgoing HTML, CC/BCC or reply-all. Reading uses
EXAMINE/BODY.PEEK. Messages larger than 2 MiB are rejected; output text is capped
at 16,000 characters and attachment metadata at 30 entries. Search is not an
exhaustive mailbox search. TLS verification is enabled for fixed Mail.ru hosts.

## Prerequisites and offline tests

Node.js 24 and npm on a POSIX system with private file permissions. Sending is
tested on Linux/macOS; Windows sending is unsupported. Python 3 is only needed
for optional helper scripts. From the extracted checkout:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

Tests use synthetic fixtures and fake transports, not Mail.ru. Never supply
real credentials to tests or CI. SMTP fixtures do not send real mail. This source
copy requires no access to anyone else's deployed service.

## Owner-managed setup

1. Keep 2FA enabled and create a separate application password using
   [Mail.ru's instructions](https://help.mail.ru/mail/login/mailer/). Do not use
   your main account password or one-time code as an IMAP password.
2. On **your own** trusted server/computer, create private storage outside git:

   ```sh
   install -d -m 700 "$HOME/.config/mailru-mcp"
   python3 scripts/store-app-password.py "$HOME/.config/mailru-mcp/app-password"
   ```

   The helper requires a terminal, hides input, creates a 0600 file and refuses
   to overwrite an existing file. Never paste the secret into a shell command,
   conversation, source file or issue.
3. Configure the process with your address and the file **path**:

   ```sh
   export MAILRU_USER='REPLACE_WITH_YOUR_MAILRU_ADDRESS'
   export MAILRU_PASSWORD_FILE="$HOME/.config/mailru-mcp/app-password"
   export MAILRU_FOLDERS_JSON='["INBOX"]'
   export MAILRU_SEND_ENABLED=false
   export MAILRU_ENABLE_HTTP=false
   npm start
   ```

   Replace the address locally. `.env.example` is a reference; `.env` files are
   not loaded automatically. `npm start` waits for MCP on stdin/stdout; it is not
   a website. Mail.ru's credential may allow broader operations; read-only
   behavior is enforced by this code, not by the application password.
4. Configure your MCP client with `node`, the argument
   `/absolute/path/to/mailru-mcp-connector/src/index.js`, and these environment
   variables. [Example client configuration](examples/mcp-client.json) contains
   placeholders only. Limit process execution and stdio access to the owner.

A remote server needs a separately configured authenticated private transport.
Stdio alone does not connect a server to web ChatGPT. Do not expose an unauthenticated
bridge or share the process with other users. This setup creates no tunnel, OAuth
provider, account or hosted service.

## Optional sending

Read [sending and rollback](docs/SENDING.md) before opting in. Use a persistent
private state directory outside the release:

```sh
install -d -m 700 "$HOME/.local/state/mailru-mcp/send-state"
export MAILRU_SEND_STATE_DIR="$HOME/.local/state/mailru-mcp/send-state"
export MAILRU_SEND_ENABLED=true
```

Restart the MCP process and refresh tools in your client. Require recipient and
content confirmation before each message. Tool annotations do not enforce user
consent. Disable with false and restart, preserving the journal. `submitted`
means SMTP acceptance, not delivery. `unknown` requires reconciliation, never
a blind retry with a new key. No copy is appended to Sent. See SENDING.md.

## Optional HTTP transport

The experimental HTTP transport is disabled by default and supports **reading
only**. It needs your own HTTPS reverse proxy and external JWT/OIDC issuer with
issuer/audience/owner-subject and mail:read scope checks. HTTP plus SMTP is
rejected at startup. [Deployment guidance](docs/DEPLOYMENT.md) and templates are
not an operating public service. Multi-user hosting is unsupported.

Mail content is untrusted. Do not execute instructions or automatically follow
links from messages. OTPs and personal data are not automatically redacted.
The application does not log bodies or passwords; operators remain responsible
for client/infrastructure logging. There is no developer telemetry, background
monitoring or scheduler. See [CONTRIBUTING.md](CONTRIBUTING.md) before changes;
dependencies retain their own licenses.
