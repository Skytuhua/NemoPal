import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import * as c from '@living-playbooks/contracts';
import type { Principal } from '../auth/credentials';
import { Messaging, LinkInput } from '../domain/messaging';
import { authenticateWebhook, capability } from '../integrations/sendblue/config';
import { parseMessage } from '../integrations/sendblue/payload';
import { reject } from '../domain/errors';

export function registerSendblue(app: FastifyInstance, messaging: Messaging, principal: (r: FastifyRequest) => Principal) {
  let count = 0, until = 0;
  app.post('/webhooks/sendblue', { bodyLimit: 16384, onRequest: async r => {
    authenticateWebhook(messaging.store.phoneConfig, r.headers['sb-signing-secret']);
  } }, r => {
    const now = messaging.store.now().getTime();
    if (now >= until) { count = 0; until = now + 60000; }
    if (++count > 120) {
      const { message } = parseMessage(r.body, messaging.store.phoneConfig);
      if (message.is_outbound || !(message.content.trim().toUpperCase() === 'STOP' || message.opted_out))
        reject(429, 'sendblue_rate', 'Webhook rate limit reached.');
    }
    return messaging.accept(r.body);
  });
  app.get('/v1/integrations/sendblue', () => capability(messaging.store.phoneConfig));
  app.post('/v1/projects/:id/sendblue/link', r => messaging.link(principal(r), r.url.split('?')[0]!, z.object({ id: c.IdSchema }).parse(r.params).id, c.revisionedCommandSchema(LinkInput).parse(r.body)));
  app.post('/v1/projects/:id/sendblue/revoke', r => messaging.revoke(principal(r), r.url.split('?')[0]!, z.object({ id: c.IdSchema }).parse(r.params).id, c.revisionedCommandSchema(z.object({ linkId: c.IdSchema }).strict()).parse(r.body)));
}
