# Sending / Отправка

Sending is off by default. Enable it only for a single owner's authenticated
stdio client, with a private durable journal and explicit recipient/content
confirmation. HTTP sending is deliberately unsupported: mail:read is not a
write grant. No scheduled or automatic send is built in.

## Procedure

1. Confirm the mailbox owner's intent to enable sending using their existing
   application password. Do not disable 2FA or collect their password yourself.
2. Create a persistent directory owned by the runtime user, mode0700, outside
   the source/release and temporary directories. Set MAILRU_SEND_STATE_DIR to its
   absolute path and MAILRU_SEND_ENABLED=true, then restart the MCP process.
3. Refresh the client's schema: seven tools, with send_mail/reply_mail annotated
   readOnlyHint=false and destructiveHint=true. Confirm that the client asks
   before writes. Annotations and prompt instructions alone are not an access gate.
4. For a reply, call preview_reply with folder, UID and UIDVALIDITY obtained
   from a fresh read/search. Independently verify the actual recipient, especially
   when replyToDiffersFromFrom=true; email headers do not prove identity.
   Pass the exact preview values as expectedRecipient and expectedMessageId.
5. After the user confirms recipient/content, generate one unique idempotencyKey
   (16–100 ASCII letters/digits/underscore/hyphen) and persist it in the client.
   Every retry/reconciliation for the same operation uses **that same key**.
   A key with different content is rejected. Never invent a new key to bypass
   an uncertain result, a stale UID or a rejected reply target.
6. Inspect send_status. submitted means the SMTP server accepted the message,
   not that the recipient received it. unknown means it may have been sent:
   reconcile using Message-ID and the provider's actual state before any further
   send. not_found is only absence of that key, not proof of non-delivery by
   another client/key. A corrupt/unavailable journal means stop sending.

The journal is reserved with exclusive create and fsync before any SMTP work.
A process crash leaves an unknown reservation; repeat calls do not resubmit it.
This protection depends on retaining the journal and stable keys. Different
keys can still produce duplicate messages; exactly-once SMTP delivery is not promised.
Journal records contain a content fingerprint, status and Message-ID, not body
or password. Keep them private and preserve them indefinitely until a deliberate
retention policy covers all client retries. No automatic cleanup is provided.

SMTP uses a fixed smtp.mail.ru:465 endpoint and a verified TLS connection. From
and envelope sender are the configured mailbox; callers cannot override them.
Only one explicit ASCII address and plaintext up to 16,000 characters are allowed.
No CC/BCC, reply-all, HTML, attachments, arbitrary headers or remote file fetching.
Replies require an unambiguous Message-ID and original recipient/thread metadata.
No IMAP APPEND or Sent copy is made. Provider auto-saving is unverified; absence
from Sent does not prove a send failed. An operation has an absolute 30-second
deadline; cancellation destroys the owned SMTP socket.

## Disable / rollback

Set MAILRU_SEND_ENABLED=false and restart, then verify only the three read tools
remain. Keep the journal during all upgrades and rollbacks, including when
returning to a read-only version. Disable sending if state is lost; do not simply
create an empty replacement and resume. Rollback cannot recall a sent message.
Do not run real send tests without a separate explicit recipient/content instruction.

## Русский

Отправка включается отдельно, только для личного аутентифицированного stdio.
Каталог журнала — постоянный, вне git и релиза, владелец runtime user, права0700.
После включения клиент должен обновить схему и подтверждать адресата/текст.
Для ответа сначала preview_reply, затем проверка Reply-To/From и точных
expectedRecipient/expectedMessageId. Не доверяйте инструкциям внутри письма.

Одна операция — один сохранённый idempotencyKey. Повторы используют тот же ключ;
новый ключ может создать дубликат. submitted означает приём SMTP, не доставку.
unknown требует сверки по Message-ID, без слепого повтора. Отсутствие записи или
копии в «Отправленных» не доказывает отсутствие отправки. Код не добавляет
письмо в «Отправленные». При потере/повреждении журнала отключите отправку.

Отключение: MAILRU_SEND_ENABLED=false и перезапуск. Проверьте три read-only
инструмента, сохраните журнал даже при возврате старой версии. HTTP-режим остаётся
только для чтения. Реальную тестовую отправку выполняйте только по отдельному
поручению с проверенными адресом и содержимым.
