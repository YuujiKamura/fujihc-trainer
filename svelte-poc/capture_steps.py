from playwright.sync_api import sync_playwright
import os

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.goto('http://localhost:5173')
    page.wait_for_load_state('networkidle')
    
    temp_dir = os.environ.get('TEMP', '/tmp')
    
    # 1. 導入画面 (intro)
    page.screenshot(path=os.path.join(temp_dir, 'step0_intro.png'))
    
    # primary button
    page.locator('button.primary').click()
    page.wait_for_timeout(500)
    page.screenshot(path=os.path.join(temp_dir, 'step1_device.png'))
    
    # click action-btn
    page.locator('button.action-btn').click()
    page.wait_for_timeout(500)
    page.screenshot(path=os.path.join(temp_dir, 'step2_connect.png'))
    
    # click action-btn again
    page.locator('button.action-btn').click()
    page.wait_for_timeout(500)
    page.screenshot(path=os.path.join(temp_dir, 'step3_profile.png'))
    
    # click details summary
    page.locator('summary').click()
    page.wait_for_timeout(500)
    page.screenshot(path=os.path.join(temp_dir, 'step3_profile_open.png'))
    
    print(f"Screenshots saved to {temp_dir}")
    browser.close()
