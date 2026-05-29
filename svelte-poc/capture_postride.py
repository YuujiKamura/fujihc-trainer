from playwright.sync_api import sync_playwright
import os

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.goto('http://localhost:5173')
    page.wait_for_load_state('networkidle')
    
    temp_dir = os.environ.get('TEMP', '/tmp')
    
    # Intro -> Setup -> Riding
    page.locator('button.primary').click()
    page.wait_for_timeout(500)
    for _ in range(5):
        page.locator('button.action-btn').click()
        page.wait_for_timeout(500)
    page.wait_for_timeout(1500)
    
    # TopBarの終了ボタン（デモ用）をクリックしてPostrideへ
    page.locator('button[title="走行終了 (デモ用)"]').click()
    page.wait_for_timeout(1000)
    
    # 走行後画面
    page.screenshot(path=os.path.join(temp_dir, 'step6_postride_suggest.png'))
    
    # 「適用する」をクリックして更新
    page.locator('button.btn-accept').click()
    page.wait_for_timeout(500)
    page.screenshot(path=os.path.join(temp_dir, 'step6_postride_accepted.png'))
    
    print(f"Screenshots saved to {temp_dir}")
    browser.close()
