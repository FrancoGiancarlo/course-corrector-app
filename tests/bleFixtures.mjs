// Deterministic firmware-format notifications; no Bluetooth hardware is used.
export function packet(type = 1, seq = 42, flags = 15) {
  const view = new DataView(new ArrayBuffer(20));
  view.setUint8(0, 0x10 | type);
  view.setUint8(1, flags);
  view.setUint16(2, seq, true);
  if (type === 1) [-32768, -1, 0, 1, 32767, 100, -100, 16384].forEach((value, i) => view.setInt16(4 + 2 * i, value, true));
  if (type === 2) {
    view.setUint32(4, 1000, true);
    [-10, 0, 100, 123, -123, 32767].forEach((value, i) => view.setInt16(8 + 2 * i, value, true));
  }
  if (type === 3) [123456, 4000000000, 7, 1500].forEach((value, i) => view.setUint32(4 + 4 * i, value, true));
  return view;
}

export const snapshot = (seq = 42, flags = 15) => [1, 2, 3].map(type => packet(type, seq, flags));
