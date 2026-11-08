import type { Pool,PoolClient } from 'pg';

export async function transaction<T>(pool:Pool,work:(db:PoolClient)=>Promise<T>):Promise<T>{
  const db=await pool.connect();
  try{await db.query('BEGIN');const result=await work(db);await db.query('COMMIT');return result;}
  catch(error){await db.query('ROLLBACK');throw error;}
  finally{db.release();}
}
