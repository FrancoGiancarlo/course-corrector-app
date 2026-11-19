import { useEffect, useState, useSyncExternalStore } from 'react';
import { bluetoothSupport, ClubBluetooth } from '../bluetoothService.js';

export function useClubBluetooth() {
  const [client] = useState(() => new ClubBluetooth());
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot);
  useEffect(() => () => client.dispose(), [client]);
  return { ...state, supportError: bluetoothSupport(), connect: client.connect,
    disconnect: client.disconnect };
}
