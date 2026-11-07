import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { transaction } from '../db/transaction';
import { reject } from '../domain/errors';
export const digest = (secret: string) => createHash('sha256').update(secret).digest('hex');
export type Principal = {
    credentialId: string;
    ownerId: string;
    deviceId: string;
};
type GrantOptions={ownerId?:string;timezone:string;reminders?:boolean};
export async function issueOperatorGrant(pool:Pool,options:GrantOptions,now=new Date()){
  return transaction(pool,async db=>{
    await db.query('SELECT pg_advisory_xact_lock(7317502)');
    const owners=(await db.query('SELECT id FROM owners ORDER BY id')).rows;
    if(owners.length>1&&!options.ownerId)reject(503,'owner_selection','Select the provisioned owner explicitly.');
    if(owners.length&&options.ownerId&&!owners.some(row=>row.id===options.ownerId))reject(403,'owner_selection','Owner is not provisioned.');
    return provisionGrant(db,{...options,ownerId:options.ownerId??owners[0]?.id},now);
  });
}
export async function revokeDevice(pool:Pool,ownerId:string,deviceId:string){
  await pool.query("UPDATE credentials SET revoked_at=now() WHERE owner_id=$1 AND device_id=$2 AND kind='access'",[ownerId,deviceId]);
}
export async function issueGrant(pool: Pool, options: {
    ownerId?: string;
    timezone: string;
    reminders?: boolean;
}, now = new Date()) {
  return transaction(pool,db=>provisionGrant(db,options,now));
}
async function provisionGrant(db:PoolClient,options:GrantOptions,now:Date){
    new Intl.DateTimeFormat('en', { timeZone: options.timezone });
    const ownerId = options.ownerId ?? randomUUID();
    const code = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + 600000).toISOString();
        await db.query('INSERT INTO owners(id,timezone,reminders) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING', [ownerId, options.timezone, options.reminders ?? false]);
        await db.query('INSERT INTO credentials(id,owner_id,kind,secret_hash,expires_at) VALUES($1,$2,$3,$4,$5)', [randomUUID(), ownerId, 'pairing', digest(code), expiresAt]);
    return { code, ownerId, expiresAt };
}
export async function redeem(pool: Pool, code: string, now = new Date()) {
    return transaction(pool, async (db) => {
        const row = (await db.query("SELECT * FROM credentials WHERE secret_hash=$1 AND kind='pairing' FOR UPDATE", [digest(code)])).rows[0];
        if (!row || row.revoked_at || row.consumed_at || new Date(row.expires_at) <= now)
            reject(401, 'invalid_grant', 'Pairing grant is unavailable.');
        const token = randomBytes(32).toString('base64url');
        const deviceId = randomUUID();
        const expiresAt = new Date(now.getTime() + 48 * 3600000).toISOString();
        await db.query('UPDATE credentials SET consumed_at=$2 WHERE id=$1', [row.id, now]);
        await db.query('INSERT INTO credentials(id,owner_id,device_id,kind,secret_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), row.owner_id, deviceId, 'access', digest(token), expiresAt]);
        return { token, deviceId, expiresAt };
    });
}
export async function authenticate(db: Pool | PoolClient, authorization?: string, now = new Date()): Promise<Principal> {
    if (!authorization?.startsWith('Bearer ') || authorization.length > 600)
        reject(401, 'unauthorized', 'Authorization is missing or expired.');
    const row = (await db.query("SELECT * FROM credentials WHERE secret_hash=$1 AND kind='access' AND revoked_at IS NULL AND expires_at>$2", [digest(authorization.slice(7)), now])).rows[0];
    if (!row)
        reject(401, 'unauthorized', 'Authorization is missing or expired.');
    return { credentialId: row.id, ownerId: row.owner_id, deviceId: row.device_id };
}
export async function reauthorize(db: PoolClient, principal: Principal, now: Date) {
    const row = (await db.query("SELECT id FROM credentials WHERE id=$1 AND owner_id=$2 AND device_id=$3 AND kind='access' AND revoked_at IS NULL AND expires_at>$4 FOR SHARE", [principal.credentialId, principal.ownerId, principal.deviceId, now])).rows[0];
    if (!row)
        reject(401, 'unauthorized', 'Authorization is missing or expired.');
    await db.query('SELECT id FROM owners WHERE id=$1 FOR UPDATE', [principal.ownerId]);
}
export function authorize(principal: Principal, _action: string, resource: {
    ownerId: string;
    deviceId?: string;
}) {
    if (principal.ownerId !== resource.ownerId || resource.deviceId && resource.deviceId !== principal.deviceId)
        reject(404, 'not_found', 'Record is unavailable.');
}
