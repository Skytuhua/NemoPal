import type { Pool } from 'pg';
import * as c from '@living-playbooks/contracts';
import { reauthorize, type Principal } from '../auth/credentials';
import { transaction } from '../db/migrate';
import { reject } from '../domain/errors';

export async function readEvents(pool:Pool,p:Principal,after:number,now=new Date()):Promise<c.ProjectEvent[]> {
  return transaction(pool,async db=>{
    await reauthorize(db,p,now);
    const range=(await db.query('SELECT coalesce(min(seq),0) AS min,coalesce(max(seq),0) AS max FROM events WHERE owner_id=$1',[p.ownerId])).rows[0];
    if(after>Number(range.max)||after!==0&&after<Number(range.min)-1)reject(409,'cursor_expired','Refresh an authorized snapshot.');
    const rows=(await db.query('SELECT e.seq,e.data FROM events e JOIN projects p ON p.id=e.project_id WHERE e.owner_id=$1 AND e.seq>$2 ORDER BY e.seq LIMIT 1000',[p.ownerId,after])).rows;
    return rows.map(r=>c.ProjectEventSchema.parse({...r.data,seq:Number(r.seq)}));
  });
}
