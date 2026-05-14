// brief 31: pmtiles.js (= BSD-3-Clause, vendored at web/lib/vendor/pmtiles.js) を
// MapLibre に pmtiles:// プロトコルとして登録する thin helper。
// 呼び出し例: registerPmtilesProtocol(maplibregl, window.pmtiles);

export function registerPmtilesProtocol(maplibregl, pmtilesGlobal) {
  if (!pmtilesGlobal) throw new Error('pmtiles global not loaded');
  if (!maplibregl || typeof maplibregl.addProtocol !== 'function') {
    throw new Error('maplibregl.addProtocol not available');
  }
  // pmtiles.Protocol() の tile method を addProtocol に渡す。
  // 冪等性: addProtocol が同名で 2 回登録されても MapLibre 4.x は throw しない、
  // 単に上書きするだけ (= test 3 で 2 回呼出 no-throw を pin)。
  const protocol = new pmtilesGlobal.Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);
  return protocol;
}
