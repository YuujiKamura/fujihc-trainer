import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, beforeEach } from 'vitest'
import App from './App.svelte'
import { appState, startRealRide } from './lib/store.svelte.js'

describe('b122a: 走行中画面のグリッドレイアウトとアトリビューション', () => {
  beforeEach(() => {
    // 状態を「走行中」にする
    appState.phase = 'riding'
    appState.isViewMode = false
  })

  it('メインコンポーネントにおけるグリッド構造が正常に描画されること（3要素）', () => {
    const { container } = render(App)
    
    // riding-layout が存在すること
    const layout = container.querySelector('.riding-layout')
    expect(layout).not.toBeNull()

    // 左右のパネルと中央のHUDコンテナが存在すること
    const leftPanel = container.querySelector('.left-panel')
    const rightPanel = container.querySelector('.right-panel')
    const centerHud = container.querySelector('.center-hud-container')

    expect(leftPanel).not.toBeNull()
    expect(rightPanel).not.toBeNull()
    expect(centerHud).not.toBeNull()

    // 3列の主要コンテナが揃っていること
    expect(leftPanel.classList.contains('side-panel')).toBe(true)
    expect(rightPanel.classList.contains('side-panel')).toBe(true)
  })

  it('中央メインHUD（HudHero）が表示されていること', () => {
    const { container } = render(App)
    
    // HudHeroコンポーネント内の特有のクラスが存在するか
    const hudHero = container.querySelector('.hud-hero')
    expect(hudHero).not.toBeNull()
    
    // スピードや勾配の要素があるか（ダミー値の確認等）
    const grade = container.querySelector('.grade .value')
    expect(grade).not.toBeNull()
  })

  it('アトリビューションバー内のリンク先が正しいURL（国土地理院・OSM）を指していること', () => {
    const { container } = render(App)
    
    const attributionBar = container.querySelector('.attribution-bar')
    expect(attributionBar).not.toBeNull()

    // リンクの検証
    const links = attributionBar.querySelectorAll('a')
    expect(links.length).toBe(2)

    // 国土地理院のリンク
    expect(links[0].href).toBe('https://maps.gsi.go.jp/development/ichiran.html')
    expect(links[0].textContent).toBe('国土地理院')

    // OpenStreetMapのリンク
    expect(links[1].href).toBe('https://www.openstreetmap.org/copyright')
    expect(links[1].textContent).toBe('OpenStreetMap')
  })
})
