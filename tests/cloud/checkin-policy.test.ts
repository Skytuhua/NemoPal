import { expect,test } from 'vitest';
import { inQuietHours,nextEligibleTime,type ReminderPreferences } from '../../apps/cloud/src/checkins/policy';

const prefs:ReminderPreferences={timezone:'America/Chicago',reminders:true,quiet_start:22,quiet_end:8,attention_limit:6};
test('quiet-hour end follows real IANA DST spring and fall transitions',()=>{
  const spring=new Date('2026-03-08T07:30:00.000Z');
  expect(inQuietHours(spring,prefs)).toBe(true);
  expect(nextEligibleTime(spring,prefs).toISOString()).toBe('2026-03-08T13:00:00.000Z');
  const fall=new Date('2026-11-01T06:30:00.000Z');
  expect(nextEligibleTime(fall,prefs).toISOString()).toBe('2026-11-01T14:00:00.000Z');
  expect(new Intl.DateTimeFormat('en-US',{timeZone:prefs.timezone,hour:'numeric',hourCycle:'h23'}).format(nextEligibleTime(fall,prefs))).toBe('08');
});
test('equal quiet endpoints disable quiet hours, and daytime windows have precise boundaries',()=>{
  expect(inQuietHours(new Date('2026-11-07T12:00:00Z'),{...prefs,quiet_start:0,quiet_end:0})).toBe(false);
  expect(inQuietHours(new Date('2026-11-07T17:00:00Z'),{...prefs,quiet_start:10,quiet_end:12})).toBe(true);
  expect(inQuietHours(new Date('2026-11-07T18:00:00Z'),{...prefs,quiet_start:10,quiet_end:12})).toBe(false);
});
