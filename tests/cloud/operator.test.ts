import { expect,test } from 'vitest';
import { issueOperatorGrant,redeem,revokeDevice } from '../../apps/cloud/src/auth/credentials';
import { setup } from './helpers';

test('repeated operator grants use the one provisioned owner, and device revocation is independent',async()=>{
  const h=await setup();
  try{
    const grant=await issueOperatorGrant(h.pool,{timezone:'America/Chicago'});expect(grant.ownerId).toBe(h.ownerId);
    const second=await redeem(h.pool,grant.code);expect((await h.request('GET','/v1/projects',undefined,second.token)).statusCode).toBe(200);
    await revokeDevice(h.pool,h.ownerId,second.deviceId);expect((await h.request('GET','/v1/projects',undefined,second.token)).statusCode).toBe(401);
    expect((await h.request('GET','/v1/projects')).statusCode).toBe(200);
  }finally{await h.close();}
});
