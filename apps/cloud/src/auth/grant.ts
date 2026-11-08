import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { issueOperatorGrant,revokeDevice } from './credentials';
import { IdSchema } from '@living-playbooks/contracts';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      if(process.argv[2]==='revoke-device'){
        await revokeDevice(pool,IdSchema.parse(process.env.LP_OWNER_ID),IdSchema.parse(process.argv[3]));
        console.log('Device credential revoked.');
      }else{
        const timezone = process.env.LP_OWNER_TIMEZONE;
        if (!timezone)
            throw new Error('Timezone required');
        const grant = await issueOperatorGrant(pool, { ...(process.env.LP_OWNER_ID ? { ownerId:IdSchema.parse(process.env.LP_OWNER_ID) } : {}), timezone, reminders: process.env.LP_REMINDERS_CONSENT === 'true' });
        console.log(JSON.stringify(grant)); // Operator-only output, never HTTP/logged by cloud.
      }
    }
    catch {
        console.error('Grant failed; set database, confirmed LP_OWNER_TIMEZONE and optional LP_OWNER_ID.');
        process.exitCode = 1;
    }
    finally {
        await pool.end();
    }
}
