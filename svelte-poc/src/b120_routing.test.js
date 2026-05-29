import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, beforeEach } from 'vitest'
import App from './App.svelte'
import { appState, backToIntro } from './lib/store.svelte.js'

describe('b120: 主画面部品の表示段階振り分けと遷移の検証', () => {
  beforeEach(() => {
    backToIntro()
  })

  it('初期状態で導入画面が表示されること', () => {
    render(App)
    expect(screen.getByText('Fujihill Trainer')).toBeDefined()
    expect(screen.getByText('鍛錬を開始する')).toBeDefined()
  })

  it('「鍛錬を開始する」ボタン押下で地形読み込み中になること', async () => {
    render(App)
    const startBtn = screen.getByText('鍛錬を開始する')
    await fireEvent.click(startBtn)
    
    expect(appState.phase).toBe('terrain_loading')
    expect(screen.getByText('地形読み込み中')).toBeDefined()
  })

  it('「コースを観る」ボタン押下で地形読み込み（観る様態）になること', async () => {
    render(App)
    const viewBtn = screen.getByText('コースを観る')
    await fireEvent.click(viewBtn)
    
    expect(appState.phase).toBe('terrain_loading')
    expect(appState.isViewMode).toBe(true)
  })

  it('ロゴボタン押下で導入画面（トップ）へ戻ること', async () => {
    render(App)
    // 状態を一旦変更
    await fireEvent.click(screen.getByText('鍛錬を開始する'))
    
    const logoBtn = screen.getByText('fujihill')
    await fireEvent.click(logoBtn)
    
    expect(appState.phase).toBe('intro')
    expect(screen.getByText('Fujihill Trainer')).toBeDefined()
  })
})
