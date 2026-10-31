import { z } from 'zod';
const folder = z.string().min(1).max(200).regex(/^[^\x00-\x1f\x7f]+$/).default('INBOX');
const query = z.string().min(1).max(200).regex(/^[^\x00-\x1f\x7f]+$/);
export const schemas = {
 list_folders: z.object({}).strict(),
 search_mail: z.object({folder, text: query.optional(), from: query.optional(), subject: query.optional(), unseen: z.boolean().optional(), limit:z.number().int().min(1).max(20).default(10)}).strict(),
 read_mail: z.object({folder, uid:z.number().int().min(1).max(4294967295), uidValidity:z.string().regex(/^\d{1,20}$/)}).strict()
};

// Deliberately a conservative ASCII mailbox subset: no lists, display names or SMTPUTF8.
export const address = z.string().min(3).max(254).regex(/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/);
const key = z.string().regex(/^[A-Za-z0-9_-]{16,100}$/);
const body = z.string().min(1).max(16000).refine(s=>!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(s));
export const messageId = z.string().max(250).regex(/^<[\x21-\x7e]+@[\x21-\x7e]+>$/).refine(s => !/[<>@]/.test(s.slice(1,-1).replace('@','')));
export const sendSchemas = {
 preview_reply: schemas.read_mail,
 send_mail: z.object({to:address,subject:query,text:body,idempotencyKey:key}).strict(),
 reply_mail: schemas.read_mail.extend({expectedRecipient:address,expectedMessageId:messageId,text:body,idempotencyKey:key}).strict(),
 send_status: z.object({idempotencyKey:key}).strict()
};
