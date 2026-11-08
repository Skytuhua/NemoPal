import { expect, it } from 'vitest';
import { startSyntheticMain } from './main-harness';

it('click-through cancels an active drag and ignores subsequent pet drag IPC until restored', async () => {
  const main = await startSyntheticMain({ withoutCredential: true });
  try {
    await main.petDrag('start'); expect(main.windows.dragPet).toHaveBeenCalledWith('start');
    main.clickTray('click-through'); expect(main.windows.cancelPetDrag).toHaveBeenCalledOnce();
    await main.petDrag('move'); expect(main.windows.dragPet).toHaveBeenCalledTimes(1);
    main.clickTray('click-through'); await main.petDrag('move');
    expect(main.windows.dragPet).toHaveBeenCalledTimes(2);
  } finally { await main.close(); }
});
