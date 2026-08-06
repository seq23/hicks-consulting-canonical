import { deliverPendingNotifications } from './lib/notification.mjs';
const results = await deliverPendingNotifications(process.env, new Date());
console.log(JSON.stringify({ ok: true, results }, null, 2));
